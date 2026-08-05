import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { authorizeCommand, requireRole } from "../auth.js";
import { missingInitialAssessmentPaths } from "../assessmentContract.js";
import { canAccessHospital } from "../hospitalScope.js";
import { validateDirectFactsRequest } from "../schemas.js";
import { getCase, getConfirmedState, saveAndConfirmDirectFacts } from "../store.js";
import { validateCaseCommand } from "../workflowSchemas.js";
import { assertCaseAccess, executeCaseCommand, getCaseMeta, getWorkflowCase } from "../workflowStore.js";
import type { CaseCommand } from "../types.js";
import {
  currentMatchingJob,
  markMatchingAwaitingManualExpansion,
  markMatchingAccepted,
  matchingJobView,
  matchingStateView,
  scheduleNextMatchingWave,
} from "./matchingExpansion.js";
import { INITIAL_MATCHING_RADIUS_KM, MAX_MATCHING_RADIUS_KM } from "./matchingPolicy.js";
import {
  isIamIdentity,
  parseAwsJson,
  principalFromAppSyncIdentity,
  resolveHospitalScope,
  type AppSyncIdentity,
} from "./appsyncIdentity.js";
import {
  getMatchJob,
  getMatchingExpansion,
  getMatchingState,
  listCasesForParamedic,
  listInboxForHospital,
  markMatchJob,
  putMatchingExpansion,
  putMatchJob,
  putMatchingState,
  requeueFailedMatchJob,
  releaseMatchJobEnqueue,
  reserveMatchJobEnqueue,
  syncCaseAssignmentIndexes,
  syncHospitalRequestIndex,
  resetDemoCasesForParamedic,
  type MatchingJobRecord,
} from "./repository.js";
import { assertDemoResetConfirmation } from "./demoReset.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const MATCHING_QUEUE_URL = process.env.MATCHING_QUEUE_URL || "";
const sqs = new SQSClient({});

type ResolverEvent = {
  field: string;
  arguments?: Record<string, unknown>;
  identity?: AppSyncIdentity;
};

function requiredId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function jsonValue(value: unknown) {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function resolveDirectFactsVersion(requestedVersion: unknown, currentVersion: number) {
  return typeof requestedVersion === "number" ? requestedVersion : currentVersion;
}

export function prepareManualStructuredFacts(
  payload: Record<string, unknown>,
  requestedVersion: unknown,
  currentVersion: number,
) {
  const validation = validateDirectFactsRequest({
    ...payload,
    expectedVersion: resolveDirectFactsVersion(requestedVersion, currentVersion),
  });
  if (!validation.ok) throw new Error(validation.issues.join(" "));
  return validation.value;
}

async function listMyCases(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  return listCasesForParamedic(principal.sub);
}

async function resetDemoCases(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  const input = event.arguments?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input은 객체여야 합니다.");
  assertDemoResetConfirmation((input as Record<string, unknown>).confirmation);
  return resetDemoCasesForParamedic(principal.sub);
}

async function getCaseSnapshot(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  const caseId = requiredId(event.arguments?.caseId, "caseId");
  await assertCaseAccess(principal, caseId);
  const [base, workflow, matchingState] = await Promise.all([
    getCase(caseId),
    getWorkflowCase(caseId),
    getMatchingState(caseId),
  ]);
  const meta = workflow.meta;
  if (!meta) return null;
  return {
    caseId,
    version: meta.version,
    stage: meta.stage,
    confirmedState: JSON.stringify(base.confirmedState),
    meta: JSON.stringify(meta),
    events: JSON.stringify(workflow.events),
    matchingState: matchingState ? JSON.stringify(matchingStateView(matchingState)) : null,
    hospitalRequests: JSON.stringify(
      principal.roles.includes("hospital") && principal.hospitalId
        ? workflow.hospitalRequests.filter((request) => canAccessHospital(principal, request.hospitalId))
        : workflow.hospitalRequests,
    ),
  };
}

async function listHospitalInbox(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  const requested = typeof event.arguments?.hospitalId === "string" ? event.arguments.hospitalId : undefined;
  return listInboxForHospital(resolveHospitalScope(principal, requested));
}

async function updateExpansionAfterHospitalResponse(caseId: string) {
  const [state, workflow] = await Promise.all([getMatchingState(caseId), getWorkflowCase(caseId)]);
  if (!state) return;
  const job = await currentMatchingJob(state);
  if (!job) return;
  const currentWaveRequests = workflow.hospitalRequests.filter((request) => request.wave === state.currentWave);
  const statuses = currentWaveRequests.map((request) => request.status);
  if (workflow.hospitalRequests.some((request) => request.status === "ACCEPTED")) {
    await markMatchingAccepted(job);
  } else if (statuses.length > 0 && statuses.every((status) => status === "DECLINED")) {
    await markMatchingAwaitingManualExpansion(job, "ALL_DECLINED");
  }
}

async function executeCommand(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  const raw = event.arguments?.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("input은 객체여야 합니다.");
  const input = raw as Record<string, unknown>;
  const caseId = requiredId(input.caseId, "caseId");
  const commandId = requiredId(input.commandId, "commandId");
  if (input.type === "SAVE_ASSESSMENT_FACTS") {
    requireRole(principal, "paramedic");
    await assertCaseAccess(principal, caseId);
    const payload = parseAwsJson(input.payload, "payload");
    const current = await getConfirmedState(caseId);
    const directFacts = prepareManualStructuredFacts(payload, input.expectedVersion, current.version);
    await saveAndConfirmDirectFacts(
      caseId,
      directFacts,
      principal.sub,
      "paramedic",
    );
    const meta = await getCaseMeta(caseId);
    if (!meta) throw new Error("사건 상태를 확인할 수 없습니다.");
    await syncCaseAssignmentIndexes(meta);
    return {
      caseId,
      version: meta.version,
      eventId: commandId,
      eventType: directFacts.kind === "reassessment" ? "REASSESSMENT_CONFIRMED" : "PATIENT_FACTS_CONFIRMED",
      stage: meta.stage,
      occurredAt: meta.updatedAt,
      ...(meta.destinationHospitalId ? { hospitalId: meta.destinationHospitalId } : {}),
      payload: jsonValue(payload),
    };
  }
  const candidate = {
    commandId,
    type: input.type,
    ...(typeof input.expectedVersion === "number" ? { expectedVersion: input.expectedVersion } : {}),
    payload: parseAwsJson(input.payload, "payload"),
  };
  const validation = validateCaseCommand(candidate);
  if (!validation.ok) throw new Error(validation.issues.join(" "));
  authorizeCommand(principal, validation.value.type);
  await assertCaseAccess(principal, caseId);
  const result = await executeCaseCommand(caseId, validation.value as CaseCommand, principal);
  const meta = await getCaseMeta(caseId);
  if (!meta) throw new Error("사건 상태를 확인할 수 없습니다.");
  await syncCaseAssignmentIndexes(meta);

  const requestId = typeof validation.value.payload.requestId === "string" ? validation.value.payload.requestId : undefined;
  const indexedRequest = requestId ? await syncHospitalRequestIndex(caseId, requestId) : undefined;
  if (validation.value.type === "HOSPITAL_RESPONSE_RECORDED") {
    try {
      await updateExpansionAfterHospitalResponse(caseId);
    } catch (error) {
      // The hospital decision is already committed. A state-update failure must
      // not hide the response from either realtime subscriber.
      console.error(JSON.stringify({
        level: "error",
        code: "MATCHING_RESPONSE_ACCELERATION_FAILED",
        caseId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }
  const updateHospitalId = typeof indexedRequest?.hospitalId === "string" ? indexedRequest.hospitalId : meta.destinationHospitalId;
  return {
    ...result,
    stage: meta.stage,
    ...(requestId ? { requestId } : {}),
    ...(updateHospitalId ? { hospitalId: updateHospitalId } : {}),
    ...(typeof indexedRequest?.status === "string" ? { requestStatus: indexedRequest.status } : {}),
    payload: jsonValue(validation.value.payload),
  };
}

function matchingInput(event: ResolverEvent) {
  const raw = event.arguments?.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("input은 객체여야 합니다.");
  const input = raw as Record<string, unknown>;
  const caseId = requiredId(input.caseId, "caseId");
  const requestId = requiredId(input.requestId, "requestId");
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("latitude 범위를 확인하세요.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("longitude 범위를 확인하세요.");
  const { radiusKm, maxRadiusKm } = resolveMatchingRadiusPolicy(input.radiusKm, input.maxRadiusKm);
  return { caseId, requestId, latitude, longitude, radiusKm, maxRadiusKm };
}

export function resolveMatchingRadiusPolicy(radius: unknown, maximum: unknown) {
  const radiusKm = radius === undefined ? INITIAL_MATCHING_RADIUS_KM : Number(radius);
  const maxRadiusKm = maximum === undefined ? MAX_MATCHING_RADIUS_KM : Number(maximum);
  if (radiusKm !== INITIAL_MATCHING_RADIUS_KM || maxRadiusKm !== MAX_MATCHING_RADIUS_KM) {
    throw new Error("병원 요청 반경은 15→30→60→120km 고정 정책을 사용합니다.");
  }
  return { radiusKm: INITIAL_MATCHING_RADIUS_KM, maxRadiusKm: MAX_MATCHING_RADIUS_KM };
}

async function putInitialMatchingState(job: MatchingJobRecord, updatedAt: string) {
  await putMatchingState({
    caseId: job.caseId,
    rootRequestId: job.rootRequestId,
    currentWave: 0,
    currentRadiusKm: 0,
    maxRadiusKm: job.maxRadiusKm,
    status: "QUEUED",
    nextRadiusKm: job.radiusKm,
    nextExpansionAt: updatedAt,
    expansionReason: "INITIAL_REQUEST",
    updatedAt,
  });
}

async function enqueueInitialMatchingJob(job: MatchingJobRecord) {
  if (!MATCHING_QUEUE_URL) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "FAILED", { errorCode: "QUEUE_NOT_CONFIGURED" });
    throw new Error("병원 매칭 대기열이 설정되지 않았습니다.");
  }
  const enqueueToken = await reserveMatchJobEnqueue(job, "IMMEDIATE");
  if (!enqueueToken) return;
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: MATCHING_QUEUE_URL, MessageBody: JSON.stringify(job) }));
  } catch (error) {
    await releaseMatchJobEnqueue(job, "IMMEDIATE", enqueueToken);
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "FAILED", { errorCode: "QUEUE_SEND_FAILED" });
    throw error;
  }
}

async function requestHospitalMatching(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  const input = matchingInput(event);
  await assertCaseAccess(principal, input.caseId);
  const [meta, state] = await Promise.all([getCaseMeta(input.caseId), getConfirmedState(input.caseId)]);
  if (!meta) throw new Error("사건을 찾을 수 없습니다.");
  if (meta.destinationHospitalId) throw new Error("이미 최종 이송지가 확정된 사건입니다.");
  const missing = missingInitialAssessmentPaths(state);
  if (missing.length) throw new Error(`환자평가 필수항목을 먼저 확인하세요: ${missing.join(", ")}`);

  const existing = await getMatchJob(input.caseId, input.requestId, 1);
  if (existing) {
    const existingJob = existing as MatchingJobRecord;
    if (existingJob.status !== "FAILED") return matchingJobView(existingJob);
    const recovered = await requeueFailedMatchJob(
      existingJob.caseId,
      existingJob.rootRequestId,
      existingJob.wave,
      INITIAL_MATCHING_RADIUS_KM,
      MAX_MATCHING_RADIUS_KM,
    );
    if (!recovered) {
      const current = await getMatchJob(input.caseId, input.requestId, 1);
      return matchingJobView((current ?? existingJob) as MatchingJobRecord);
    }
    const recoveredJob = recovered as MatchingJobRecord;
    const recoveredAt = new Date().toISOString();
    await putInitialMatchingState(recoveredJob, recoveredAt);
    await enqueueInitialMatchingJob(recoveredJob);
    return matchingJobView(recoveredJob);
  }

  const now = new Date().toISOString();
  const job: MatchingJobRecord = {
    jobId: `${input.requestId}-W1`,
    rootRequestId: input.requestId,
    caseId: input.caseId,
    status: "QUEUED",
    wave: 1,
    latitude: input.latitude,
    longitude: input.longitude,
    previousRadiusKm: 0,
    radiusKm: input.radiusKm,
    maxRadiusKm: input.maxRadiusKm,
    expansionReason: "INITIAL_REQUEST",
    requestedBy: principal.sub,
    createdAt: now,
    updatedAt: now,
  };
  await putMatchJob(job);
  await putInitialMatchingState(job, now);
  await enqueueInitialMatchingJob(job);
  return matchingJobView(job);
}

async function expandHospitalMatching(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  const raw = event.arguments?.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("input은 객체여야 합니다.");
  const input = raw as Record<string, unknown>;
  const caseId = requiredId(input.caseId, "caseId");
  const expansionId = requiredId(input.expansionId, "expansionId");
  await assertCaseAccess(principal, caseId);

  const priorExpansion = await getMatchingExpansion(caseId, expansionId);
  if (priorExpansion) {
    const priorJob = await getMatchJob(caseId, priorExpansion.rootRequestId, priorExpansion.wave);
    if (priorJob) return matchingJobView(priorJob as MatchingJobRecord);
  }

  const [meta, state, workflow] = await Promise.all([
    getCaseMeta(caseId),
    getMatchingState(caseId),
    getWorkflowCase(caseId),
  ]);
  if (!meta || !state || state.currentWave < 1) throw new Error("먼저 최초 병원 요청을 시작해 주세요.");
  if (meta.destinationHospitalId || workflow.hospitalRequests.some((request) => request.status === "ACCEPTED")) {
    throw new Error("수용 가능한 병원이 회신한 뒤에는 요청 범위를 확대할 수 없습니다.");
  }
  const current = await currentMatchingJob(state);
  if (!current) throw new Error("현재 병원 요청 상태를 찾을 수 없습니다.");
  const next = await scheduleNextMatchingWave(current, "MANUAL_REQUEST", { immediate: true });
  if (!next) throw new Error("설정된 최대 요청 반경까지 확인했습니다.");
  await putMatchingExpansion(caseId, expansionId, next.rootRequestId, next.wave);
  return matchingJobView(next);
}

function internalPublish(event: ResolverEvent) {
  if (!isIamIdentity(event.identity)) throw new Error("IAM 내부 발행자만 호출할 수 있습니다.");
  const input = event.arguments?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input은 객체여야 합니다.");
  return input;
}

async function authorizeCaseSubscription(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  await assertCaseAccess(principal, requiredId(event.arguments?.caseId, "caseId"));
  return null;
}

function authorizeHospitalSubscription(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  resolveHospitalScope(principal, requiredId(event.arguments?.hospitalId, "hospitalId"));
  return null;
}

export async function handler(event: ResolverEvent) {
  switch (event.field) {
    case "listMyCases": return listMyCases(event);
    case "getCase": return getCaseSnapshot(event);
    case "listHospitalInbox": return listHospitalInbox(event);
    case "executeCommand": return executeCommand(event);
    case "requestHospitalMatching": return requestHospitalMatching(event);
    case "expandHospitalMatching": return expandHospitalMatching(event);
    case "resetDemoCases": return resetDemoCases(event);
    case "onCaseUpdate": return authorizeCaseSubscription(event);
    case "onHospitalInbox": return authorizeHospitalSubscription(event);
    case "publishCaseUpdate":
      return internalPublish(event);
    default: throw new Error(`지원하지 않는 AppSync field입니다: ${event.field}`);
  }
}
