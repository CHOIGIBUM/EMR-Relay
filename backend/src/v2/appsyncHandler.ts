import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { authorizeCommand, requireRole } from "../auth.js";
import { missingInitialAssessmentPaths } from "../assessmentContract.js";
import { validateDirectFactsRequest } from "../schemas.js";
import { getCase, getConfirmedState, saveAndConfirmDirectFacts } from "../store.js";
import { validateCaseCommand } from "../workflowSchemas.js";
import { assertCaseAccess, executeCaseCommand, getCaseMeta, getWorkflowCase } from "../workflowStore.js";
import type { CaseCommand } from "../types.js";
import {
  isIamIdentity,
  parseAwsJson,
  principalFromAppSyncIdentity,
  resolveHospitalScope,
  type AppSyncIdentity,
} from "./appsyncIdentity.js";
import {
  getMatchJob,
  listCasesForParamedic,
  listInboxForHospital,
  markMatchJob,
  putMatchJob,
  syncCaseAssignmentIndexes,
  syncHospitalRequestIndex,
  type MatchingJobRecord,
} from "./repository.js";

const MATCHING_QUEUE_URL = process.env.MATCHING_QUEUE_URL || "";
const sqs = new SQSClient({});
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

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

async function getCaseSnapshot(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  const caseId = requiredId(event.arguments?.caseId, "caseId");
  await assertCaseAccess(principal, caseId);
  const [base, workflow] = await Promise.all([getCase(caseId), getWorkflowCase(caseId)]);
  const meta = workflow.meta;
  if (!meta) return null;
  return {
    caseId,
    version: meta.version,
    stage: meta.stage,
    confirmedState: JSON.stringify(base.confirmedState),
    meta: JSON.stringify(meta),
    events: JSON.stringify(workflow.events),
    hospitalRequests: JSON.stringify(
      principal.roles.includes("hospital") && principal.hospitalId
        ? workflow.hospitalRequests.filter((request) => request.hospitalId === principal.hospitalId)
        : workflow.hospitalRequests,
    ),
  };
}

async function listHospitalInbox(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  const requested = typeof event.arguments?.hospitalId === "string" ? event.arguments.hospitalId : undefined;
  return listInboxForHospital(resolveHospitalScope(principal, requested));
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
  const radiusKm = input.radiusKm === undefined ? 15 : Number(input.radiusKm);
  const maxRadiusKm = input.maxRadiusKm === undefined ? 120 : Number(input.maxRadiusKm);
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 200) throw new Error("radiusKm는 1~200km 범위여야 합니다.");
  if (!Number.isFinite(maxRadiusKm) || maxRadiusKm < radiusKm || maxRadiusKm > 300) throw new Error("maxRadiusKm를 확인하세요.");
  return { caseId, requestId, latitude, longitude, radiusKm, maxRadiusKm };
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
  if (existing) return {
    jobId: existing.jobId,
    caseId: existing.caseId,
    status: existing.status,
    wave: existing.wave,
    radiusKm: existing.radiusKm,
    maxRadiusKm: existing.maxRadiusKm,
    createdAt: existing.createdAt,
  };

  const now = new Date().toISOString();
  const job: MatchingJobRecord = {
    jobId: `${input.requestId}-W1`,
    rootRequestId: input.requestId,
    caseId: input.caseId,
    status: "QUEUED",
    wave: 1,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusKm: input.radiusKm,
    maxRadiusKm: input.maxRadiusKm,
    requestedBy: principal.sub,
    createdAt: now,
    updatedAt: now,
  };
  await putMatchJob(job);
  if (!MATCHING_QUEUE_URL) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "FAILED", { errorCode: "QUEUE_NOT_CONFIGURED" });
    throw new Error("병원 매칭 대기열이 설정되지 않았습니다.");
  }
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: MATCHING_QUEUE_URL, MessageBody: JSON.stringify(job) }));
  } catch (error) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "FAILED", { errorCode: "QUEUE_SEND_FAILED" });
    throw error;
  }
  return {
    jobId: job.jobId,
    caseId: job.caseId,
    status: job.status,
    wave: job.wave,
    radiusKm: job.radiusKm,
    maxRadiusKm: job.maxRadiusKm,
    createdAt: job.createdAt,
  };
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
    case "onCaseUpdate": return authorizeCaseSubscription(event);
    case "onHospitalInbox": return authorizeHospitalSubscription(event);
    case "publishCaseUpdate":
      return internalPublish(event);
    default: throw new Error(`지원하지 않는 AppSync field입니다: ${event.field}`);
  }
}
