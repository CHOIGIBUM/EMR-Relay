import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CaseMeta, ConfirmedState, HospitalRequest } from "../types.js";
import {
  resetDemoCases,
  type DemoResetItem,
  type DemoResetKey,
  type DemoResetStorage,
} from "./demoReset.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-v2-local";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const casePk = (caseId: string) => `CASE#${caseId}`;
export const matchJobSk = (requestId: string, wave: number) => `MATCH_JOB#${requestId}#W${wave}`;
const requestSk = (requestId: string) => `HOSPITAL_REQUEST#${requestId}`;
const eventSk = (occurredAt: string, eventId: string) => `EVENT#${occurredAt}#${eventId}`;

export type MatchingJobRecord = {
  jobId: string;
  rootRequestId: string;
  caseId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "SKIPPED";
  wave: number;
  latitude: number;
  longitude: number;
  radiusKm: number;
  maxRadiusKm: number;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
};

export type HospitalReferenceDirectory = Awaited<ReturnType<typeof import("../external/hospitalReferenceService.js").getHospitalReferences>>;

const demoResetStorage: DemoResetStorage = {
  async listPartitionKeys(partitionKey) {
    const keys: DemoResetKey[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": partitionKey },
        ProjectionExpression: "PK, SK",
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }));
      for (const item of page.Items ?? []) {
        if (typeof item.PK === "string" && typeof item.SK === "string") keys.push({ PK: item.PK, SK: item.SK });
      }
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return keys;
  },

  async deleteKeys(keys) {
    for (let offset = 0; offset < keys.length; offset += 25) {
      let pending = keys.slice(offset, offset + 25).map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; pending.length; attempt += 1) {
        if (attempt >= 8) throw new Error("시연 사건 레코드 삭제를 완료하지 못했습니다. 잠시 후 다시 시도하세요.");
        const response = await client.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: pending } }));
        pending = (response.UnprocessedItems?.[TABLE_NAME] ?? []).flatMap((request) => {
          const PK = request.DeleteRequest?.Key?.PK;
          const SK = request.DeleteRequest?.Key?.SK;
          return typeof PK === "string" && typeof SK === "string"
            ? [{ DeleteRequest: { Key: { PK, SK } } }]
            : [];
        });
        if (pending.length) await new Promise((resolve) => setTimeout(resolve, Math.min(500, 50 * (attempt + 1))));
      }
    }
  },

  async putItems(items: DemoResetItem[]) {
    await client.send(new TransactWriteCommand({
      TransactItems: items.map((Item) => ({
        Put: {
          TableName: TABLE_NAME,
          Item,
          ConditionExpression: "attribute_not_exists(PK)",
        },
      })),
    }));
  },
};

export function resetDemoCasesForParamedic(paramedicSub: string, baseTime = Date.now()) {
  return resetDemoCases(demoResetStorage, paramedicSub, baseTime);
}

export async function listCasesForParamedic(paramedicSub: string) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "ParamedicCasesIndex",
    KeyConditionExpression: "GSI2PK = :pk",
    ExpressionAttributeValues: { ":pk": `PARAMEDIC#${paramedicSub}` },
    ScanIndexForward: false,
    Limit: 50,
  }));
  return (result.Items ?? []).map((item) => ({
    caseId: String(item.caseId),
    version: Number(item.version ?? 0),
    stage: String(item.stage ?? "ASSIGNED"),
    ...(typeof item.scenario === "string" ? { scenario: item.scenario } : {}),
    ...(typeof item.reportTime === "string" ? { reportTime: item.reportTime } : {}),
    ...(typeof item.reportSummary === "string" ? { reportSummary: item.reportSummary } : {}),
    ...(typeof item.reportDetail === "string" ? { reportDetail: item.reportDetail } : {}),
    ...(typeof item.estimatedAge === "string" ? { estimatedAge: item.estimatedAge } : {}),
    ...(typeof item.estimatedSex === "string" ? { estimatedSex: item.estimatedSex } : {}),
    ...(typeof item.reporter === "string" ? { reporter: item.reporter } : {}),
    ...(typeof item.station === "string" ? { station: item.station } : {}),
    ...(typeof item.sceneAddress === "string" ? { sceneAddress: item.sceneAddress } : {}),
    ...(typeof item.sceneLatitude === "number" ? { sceneLatitude: item.sceneLatitude } : {}),
    ...(typeof item.sceneLongitude === "number" ? { sceneLongitude: item.sceneLongitude } : {}),
    ...(typeof item.agency === "string" ? { agency: item.agency } : {}),
    ...(typeof item.unitId === "string" ? { unitId: item.unitId } : {}),
    ...(typeof item.vehicleNumber === "string" ? { vehicleNumber: item.vehicleNumber } : {}),
    ...(typeof item.destinationHospitalId === "string" ? { destinationHospitalId: item.destinationHospitalId } : {}),
    updatedAt: String(item.updatedAt),
  }));
}

export async function listInboxForHospital(hospitalId: string) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "HospitalInboxIndex",
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": `HOSPITAL#${hospitalId}` },
    ScanIndexForward: false,
    Limit: 50,
  }));
  return (result.Items ?? []).map((item) => ({
    requestId: String(item.requestId),
    caseId: String(item.caseId),
    hospitalId: String(item.hospitalId),
    ...(typeof item.hospitalName === "string" ? { hospitalName: item.hospitalName } : {}),
    status: String(item.status ?? "REQUESTED"),
    ...(typeof item.wave === "number" ? { wave: item.wave } : {}),
    ...(typeof item.radiusKm === "number" ? { radiusKm: item.radiusKm } : {}),
    ...(typeof item.distanceKm === "number" ? { distanceKm: item.distanceKm } : {}),
    ...(typeof item.etaMinutes === "number" ? { etaMinutes: item.etaMinutes } : {}),
    patientCard: JSON.stringify(item.patientCard ?? {}),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  }));
}

export async function syncCaseAssignmentIndexes(meta: CaseMeta) {
  await Promise.all(meta.assignedParamedicIds.map((paramedicSub) => client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: casePk(meta.caseId),
      SK: `ASSIGNMENT#${paramedicSub}`,
      entityType: "CASE_ASSIGNMENT",
      GSI2PK: `PARAMEDIC#${paramedicSub}`,
      GSI2SK: `${meta.updatedAt}#${meta.caseId}`,
      ...meta,
    },
  }))));
}

export async function syncHospitalRequestIndex(caseId: string, requestId: string) {
  const key = { PK: casePk(caseId), SK: requestSk(requestId) };
  const current = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }));
  if (!current.Item || typeof current.Item.hospitalId !== "string") return undefined;
  const updatedAt = typeof current.Item.updatedAt === "string" ? current.Item.updatedAt : new Date().toISOString();
  await client.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: key,
    UpdateExpression: "SET GSI1PK = :pk, GSI1SK = :sk",
    ExpressionAttributeValues: {
      ":pk": `HOSPITAL#${current.Item.hospitalId}`,
      ":sk": `${updatedAt}#${caseId}#${requestId}`,
    },
  }));
  return current.Item;
}

export async function getMatchJob(caseId: string, requestId: string, wave: number) {
  const result = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: matchJobSk(requestId, wave) },
    ConsistentRead: true,
  }));
  return result.Item as (MatchingJobRecord & Record<string, unknown>) | undefined;
}

export async function putMatchJob(job: MatchingJobRecord) {
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: casePk(job.caseId),
      SK: matchJobSk(job.rootRequestId, job.wave),
      entityType: "MATCH_JOB",
      ...job,
      expiresAt: Math.floor(Date.now() / 1_000) + 86_400,
    },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
}

export async function markMatchJob(
  caseId: string,
  requestId: string,
  wave: number,
  status: MatchingJobRecord["status"],
  details: Record<string, unknown> = {},
) {
  const names: Record<string, string> = { "#status": "status" };
  const values: Record<string, unknown> = { ":status": status, ":updatedAt": new Date().toISOString() };
  const assignments = ["#status = :status", "updatedAt = :updatedAt"];
  Object.entries(details).forEach(([key, value], index) => {
    names[`#d${index}`] = key;
    values[`:d${index}`] = value;
    assignments.push(`#d${index} = :d${index}`);
  });
  await client.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: matchJobSk(requestId, wave) },
    UpdateExpression: `SET ${assignments.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

function referenceCacheKey(latitude: number, longitude: number) {
  return `CACHE#HOSPITALS#${latitude.toFixed(2)}#${longitude.toFixed(2)}`;
}

export async function getHospitalReferenceCache(latitude: number, longitude: number) {
  const result = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: referenceCacheKey(latitude, longitude), SK: "REFERENCES" },
  }));
  if (!result.Item || Number(result.Item.expiresAt ?? 0) <= Math.floor(Date.now() / 1_000)) return undefined;
  return result.Item.directory as HospitalReferenceDirectory | undefined;
}

export async function putHospitalReferenceCache(latitude: number, longitude: number, directory: HospitalReferenceDirectory) {
  const now = Math.floor(Date.now() / 1_000);
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: referenceCacheKey(latitude, longitude),
      SK: "REFERENCES",
      entityType: "HOSPITAL_REFERENCE_CACHE",
      directory,
      cachedAt: new Date().toISOString(),
      expiresAt: now + 180,
    },
  }));
}

export async function writeMatchingWave(input: {
  job: MatchingJobRecord;
  meta: CaseMeta;
  confirmedState: ConfirmedState;
  requests: Array<HospitalRequest & Record<string, unknown>>;
}) {
  const occurredAt = new Date().toISOString();
  const eventId = randomUUID();
  const version = input.meta.version + 1;
  const nextMeta: CaseMeta = {
    ...input.meta,
    version,
    stage: "HOSPITAL_REQUESTED",
    updatedAt: occurredAt,
  };
  const transactItems = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(input.meta.caseId), SK: "META", entityType: "CASE_META", ...nextMeta },
        ConditionExpression: "#version = :expected",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":expected": input.meta.version },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: casePk(input.meta.caseId),
          SK: eventSk(occurredAt, eventId),
          entityType: "CASE_EVENT",
          eventId,
          caseId: input.meta.caseId,
          type: "HOSPITAL_BROADCAST_STARTED",
          actorSub: "MATCHING_WORKER",
          actorRole: "system",
          occurredAt,
          version,
          summary: "인근 병원에 수용 가능 여부를 동시 요청했습니다.",
          payload: {
            matchingJobId: input.job.jobId,
            wave: input.job.wave,
            radiusKm: input.job.radiusKm,
            requestIds: input.requests.map((request) => request.requestId),
          },
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: casePk(input.job.caseId), SK: matchJobSk(input.job.rootRequestId, input.job.wave) },
        UpdateExpression: "SET #status = :completed, updatedAt = :updatedAt, candidateCount = :count",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":completed": "COMPLETED", ":updatedAt": occurredAt, ":count": input.requests.length },
      },
    },
    ...input.requests.map((request) => ({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: casePk(input.meta.caseId),
          SK: requestSk(request.requestId),
          entityType: "HOSPITAL_REQUEST",
          ...request,
          patientCard: input.confirmedState.facts,
          GSI1PK: `HOSPITAL#${request.hospitalId}`,
          GSI1SK: `${request.updatedAt}#${input.meta.caseId}#${request.requestId}`,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    })),
  ];
  await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
  await syncCaseAssignmentIndexes(nextMeta);
  return { version, eventId, occurredAt, stage: nextMeta.stage };
}
