import { createHash } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { getHospitalReferences } from "../external/hospitalReferenceService.js";
import { getConfirmedState } from "../store.js";
import { getCaseMeta, getWorkflowCase } from "../workflowStore.js";
import type { HospitalRequest } from "../types.js";
import { publishCaseUpdate } from "./appsyncPublisher.js";
import { nextWaveRadius, selectWaveCandidates, shouldStopExpansion, type MatchCandidate } from "./matchingPolicy.js";
import {
  getHospitalReferenceCache,
  getMatchJob,
  markMatchJob,
  putHospitalReferenceCache,
  putMatchJob,
  writeMatchingWave,
  type MatchingJobRecord,
} from "./repository.js";

const MATCHING_QUEUE_URL = process.env.MATCHING_QUEUE_URL || "";
const sqs = new SQSClient({});

function requestIdFor(job: MatchingJobRecord, hospitalId: string) {
  return `REQ-${createHash("sha256").update(`${job.rootRequestId}|${job.wave}|${hospitalId}`).digest("hex").slice(0, 24)}`;
}

async function directoryFor(job: MatchingJobRecord) {
  const cached = await getHospitalReferenceCache(job.latitude, job.longitude);
  if (cached) return cached;
  const directory = await getHospitalReferences(job.latitude, job.longitude);
  await putHospitalReferenceCache(job.latitude, job.longitude, directory);
  return directory;
}

async function enqueueNextWave(job: MatchingJobRecord) {
  const radiusKm = nextWaveRadius(job.radiusKm, job.maxRadiusKm);
  if (radiusKm === null || !MATCHING_QUEUE_URL) return;
  const wave = job.wave + 1;
  const existing = await getMatchJob(job.caseId, job.rootRequestId, wave);
  const now = new Date().toISOString();
  const nextJob: MatchingJobRecord = existing ?? {
    ...job,
    jobId: `${job.rootRequestId}-W${wave}`,
    status: "QUEUED",
    wave,
    radiusKm,
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) await putMatchJob(nextJob);
  if (nextJob.status !== "QUEUED") return;
  await sqs.send(new SendMessageCommand({
    QueueUrl: MATCHING_QUEUE_URL,
    DelaySeconds: 45,
    MessageBody: JSON.stringify(nextJob),
  }));
}

async function publishWaveResult(
  job: MatchingJobRecord,
  meta: NonNullable<Awaited<ReturnType<typeof getCaseMeta>>>,
  requests: Array<HospitalRequest & Record<string, unknown>>,
) {
  if (requests.length > 0) {
    await Promise.all(requests.map((request) => publishCaseUpdate({
      caseId: job.caseId,
      version: meta.version,
      eventId: request.requestId,
      eventType: "HOSPITAL_REQUEST_CREATED",
      stage: meta.stage,
      occurredAt: request.updatedAt,
      requestId: request.requestId,
      hospitalId: request.hospitalId,
      requestStatus: request.status,
      payload: JSON.stringify({ wave: job.wave, radiusKm: job.radiusKm }),
    })));
    return;
  }
  const nextRadiusKm = nextWaveRadius(job.radiusKm, job.maxRadiusKm);
  await publishCaseUpdate({
    caseId: job.caseId,
    version: meta.version,
    eventId: `${job.jobId}-STATUS`,
    eventType: nextRadiusKm === null ? "HOSPITAL_MATCHING_EXHAUSTED" : "HOSPITAL_MATCH_WAVE_EMPTY",
    stage: meta.stage,
    occurredAt: new Date().toISOString(),
    payload: JSON.stringify({ wave: job.wave, radiusKm: job.radiusKm, nextRadiusKm }),
  });
}

async function publishWaveResultSafely(
  job: MatchingJobRecord,
  meta: NonNullable<Awaited<ReturnType<typeof getCaseMeta>>>,
  requests: Array<HospitalRequest & Record<string, unknown>>,
) {
  try {
    await publishWaveResult(job, meta, requests);
  } catch (error) {
    // Matching is already committed in DynamoDB. Realtime delivery is an
    // acceleration path, so a transient AppSync failure must not roll back the
    // workflow or prevent the next radius wave from being scheduled.
    console.error(JSON.stringify({
      level: "error",
      code: "REALTIME_PUBLISH_FAILED",
      caseId: job.caseId,
      wave: job.wave,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
  }
}

async function processJob(message: MatchingJobRecord) {
  const stored = await getMatchJob(message.caseId, message.rootRequestId, message.wave);
  if (!stored || stored.status === "SKIPPED") return;
  const job: MatchingJobRecord = {
    jobId: String(stored.jobId),
    rootRequestId: String(stored.rootRequestId),
    caseId: String(stored.caseId),
    status: stored.status,
    wave: Number(stored.wave),
    latitude: Number(stored.latitude),
    longitude: Number(stored.longitude),
    radiusKm: Number(stored.radiusKm),
    maxRadiusKm: Number(stored.maxRadiusKm),
    requestedBy: String(stored.requestedBy),
    createdAt: String(stored.createdAt),
    updatedAt: String(stored.updatedAt),
  };
  if (stored.status === "COMPLETED") {
    const [meta, workflow] = await Promise.all([getCaseMeta(job.caseId), getWorkflowCase(job.caseId)]);
    if (!meta) return;
    const requests = workflow.hospitalRequests.filter((request) => request.broadcastId === `${job.rootRequestId}-W${job.wave}`);
    await publishWaveResultSafely(job, meta, requests);
    await enqueueNextWave(job);
    return;
  }
  await markMatchJob(job.caseId, job.rootRequestId, job.wave, "PROCESSING");

  const [meta, workflow, confirmedState] = await Promise.all([
    getCaseMeta(job.caseId),
    getWorkflowCase(job.caseId),
    getConfirmedState(job.caseId),
  ]);
  if (!meta) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "FAILED", { errorCode: "CASE_NOT_FOUND" });
    return;
  }
  const acceptedRequestCount = workflow.hospitalRequests.filter((request) => request.status === "ACCEPTED").length;
  if (shouldStopExpansion({
    ...(meta.destinationHospitalId ? { destinationHospitalId: meta.destinationHospitalId } : {}),
    acceptedRequestCount,
  })) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "SKIPPED", {
      skipReason: meta.destinationHospitalId ? "DESTINATION_CONFIRMED" : "ACCEPTED_CANDIDATE_EXISTS",
    });
    return;
  }

  const directory = await directoryFor(job);
  const excluded = new Set(workflow.hospitalRequests.map((request) => request.hospitalId));
  const candidates = selectWaveCandidates(
    directory.hospitals as MatchCandidate[],
    job.radiusKm,
    excluded,
    3,
  );
  if (!candidates.length) {
    await markMatchJob(job.caseId, job.rootRequestId, job.wave, "COMPLETED", { candidateCount: 0 });
    await publishWaveResultSafely(job, meta, []);
    await enqueueNextWave(job);
    return;
  }

  const occurredAt = new Date().toISOString();
  const requests: Array<HospitalRequest & Record<string, unknown>> = candidates.map((candidate) => ({
    requestId: requestIdFor(job, candidate.hospital_id),
    caseId: job.caseId,
    broadcastId: `${job.rootRequestId}-W${job.wave}`,
    wave: job.wave,
    radiusKm: job.radiusKm,
    hospitalId: candidate.hospital_id,
    hospitalName: candidate.display_name,
    distanceKm: candidate.distance_km,
    etaMinutes: candidate.eta_minutes,
    ...(typeof candidate.region_label === "string" ? { regionLabel: candidate.region_label } : {}),
    ...(typeof candidate.latitude === "number" ? { hospitalLatitude: candidate.latitude } : {}),
    ...(typeof candidate.longitude === "number" ? { hospitalLongitude: candidate.longitude } : {}),
    status: "REQUESTED",
    requestedBy: job.requestedBy,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    referenceCapabilities: candidate.reference_capabilities ?? [],
    referenceSource: candidate.reference_source ?? candidate.source ?? "NMC_HIRA",
  }));
  const committed = await writeMatchingWave({ job, meta, confirmedState, requests });
  await publishWaveResultSafely(job, { ...meta, version: committed.version, stage: committed.stage }, requests);
  await enqueueNextWave(job);
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body) as MatchingJobRecord;
      await processJob(parsed);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        messageId: record.messageId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
