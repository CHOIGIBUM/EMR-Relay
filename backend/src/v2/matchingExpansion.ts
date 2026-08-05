import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { nextWaveRadius } from "./matchingPolicy.js";
import {
  getMatchJob,
  putMatchingState,
  putMatchJobIfAbsent,
  releaseMatchJobEnqueue,
  reserveMatchJobEnqueue,
  type MatchingExpansionReason,
  type MatchingJobRecord,
  type MatchingStateRecord,
} from "./repository.js";

const sqs = new SQSClient({});

export function matchingResponseWindowSeconds() {
  const configured = Number(process.env.MATCHING_RESPONSE_WINDOW_SECONDS ?? 30);
  return Number.isFinite(configured) ? Math.min(900, Math.max(30, Math.floor(configured))) : 30;
}

export function matchingJobView(job: MatchingJobRecord) {
  return {
    jobId: job.jobId,
    caseId: job.caseId,
    status: job.status,
    wave: job.wave,
    radiusKm: job.radiusKm,
    ...(typeof job.previousRadiusKm === "number" ? { previousRadiusKm: job.previousRadiusKm } : {}),
    maxRadiusKm: job.maxRadiusKm,
    ...(job.notBeforeAt ? { nextExpansionAt: job.notBeforeAt } : {}),
    ...(job.expansionReason ? { expansionReason: job.expansionReason } : {}),
    createdAt: job.createdAt,
  };
}

export function matchingStateView(state: MatchingStateRecord) {
  return {
    caseId: state.caseId,
    rootRequestId: state.rootRequestId,
    currentWave: state.currentWave,
    currentRadiusKm: state.currentRadiusKm,
    maxRadiusKm: state.maxRadiusKm,
    status: state.status,
    ...(typeof state.nextRadiusKm === "number" ? { nextRadiusKm: state.nextRadiusKm } : {}),
    ...(state.nextExpansionAt ? { nextExpansionAt: state.nextExpansionAt } : {}),
    expansionReason: state.expansionReason,
    updatedAt: state.updatedAt,
  };
}

export async function enqueueMatchingJob(job: MatchingJobRecord, delaySeconds = 0) {
  const queueUrl = process.env.MATCHING_QUEUE_URL ?? "";
  if (!queueUrl) throw new Error("병원 매칭 대기열이 설정되지 않았습니다.");
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    DelaySeconds: Math.min(900, Math.max(0, Math.floor(delaySeconds))),
    MessageBody: JSON.stringify(job),
  }));
}

export async function scheduleNextMatchingWave(
  current: MatchingJobRecord,
  reason: Exclude<MatchingExpansionReason, "INITIAL_REQUEST" | "MAX_RADIUS_REACHED" | "ACCEPTED">,
  options: { immediate?: boolean; now?: Date } = {},
) {
  if (reason !== "MANUAL_REQUEST" || options.immediate !== true) {
    throw new Error("병원 요청 범위는 구급대원의 수동 확대 요청으로만 변경할 수 있습니다.");
  }
  const now = options.now ?? new Date();
  const nextRadiusKm = nextWaveRadius(current.radiusKm, current.maxRadiusKm);
  if (nextRadiusKm === null) {
    await putMatchingState({
      caseId: current.caseId,
      rootRequestId: current.rootRequestId,
      currentWave: current.wave,
      currentRadiusKm: current.radiusKm,
      maxRadiusKm: current.maxRadiusKm,
      status: "EXHAUSTED",
      expansionReason: "MAX_RADIUS_REACHED",
      updatedAt: now.toISOString(),
    });
    return null;
  }

  const delaySeconds = options.immediate ? 0 : matchingResponseWindowSeconds();
  const notBeforeAt = new Date(now.getTime() + delaySeconds * 1_000).toISOString();
  const nextWave = current.wave + 1;
  const proposed: MatchingJobRecord = {
    ...current,
    jobId: `${current.rootRequestId}-W${nextWave}`,
    status: "QUEUED",
    wave: nextWave,
    previousRadiusKm: current.radiusKm,
    radiusKm: nextRadiusKm,
    notBeforeAt,
    expansionReason: reason,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const { job } = await putMatchJobIfAbsent(proposed);
  if (job.status !== "QUEUED") return job;
  const channel = options.immediate ? "IMMEDIATE" : "DELAYED";
  const enqueueToken = await reserveMatchJobEnqueue(job, channel);
  if (!enqueueToken) return job;
  try {
    await enqueueMatchingJob(job, delaySeconds);
  } catch (error) {
    await releaseMatchJobEnqueue(job, channel, enqueueToken);
    throw error;
  }
  await putMatchingState({
    caseId: current.caseId,
    rootRequestId: current.rootRequestId,
    currentWave: current.wave,
    currentRadiusKm: current.radiusKm,
    maxRadiusKm: current.maxRadiusKm,
    status: options.immediate ? "EXPANSION_QUEUED" : "WAITING_RESPONSES",
    nextRadiusKm,
    nextExpansionAt: options.immediate ? now.toISOString() : job.notBeforeAt ?? notBeforeAt,
    expansionReason: reason,
    updatedAt: now.toISOString(),
  });
  return job;
}

export async function markMatchingAwaitingManualExpansion(
  current: MatchingJobRecord,
  reason: Exclude<MatchingExpansionReason, "MAX_RADIUS_REACHED" | "ACCEPTED">,
  now = new Date(),
) {
  const nextRadiusKm = nextWaveRadius(current.radiusKm, current.maxRadiusKm);
  if (nextRadiusKm === null) {
    await putMatchingState({
      caseId: current.caseId,
      rootRequestId: current.rootRequestId,
      currentWave: current.wave,
      currentRadiusKm: current.radiusKm,
      maxRadiusKm: current.maxRadiusKm,
      status: "EXHAUSTED",
      expansionReason: "MAX_RADIUS_REACHED",
      updatedAt: now.toISOString(),
    });
    return;
  }
  await putMatchingState({
    caseId: current.caseId,
    rootRequestId: current.rootRequestId,
    currentWave: current.wave,
    currentRadiusKm: current.radiusKm,
    maxRadiusKm: current.maxRadiusKm,
    status: "WAITING_RESPONSES",
    nextRadiusKm,
    expansionReason: reason,
    updatedAt: now.toISOString(),
  });
}

export async function currentMatchingJob(input: {
  caseId: string;
  rootRequestId: string;
  currentWave: number;
}) {
  const job = await getMatchJob(input.caseId, input.rootRequestId, input.currentWave);
  return job as MatchingJobRecord | undefined;
}

export async function markMatchingAccepted(job: MatchingJobRecord, now = new Date()) {
  await putMatchingState({
    caseId: job.caseId,
    rootRequestId: job.rootRequestId,
    currentWave: job.wave,
    currentRadiusKm: job.radiusKm,
    maxRadiusKm: job.maxRadiusKm,
    status: "ACCEPTED",
    expansionReason: "ACCEPTED",
    updatedAt: now.toISOString(),
  });
}
