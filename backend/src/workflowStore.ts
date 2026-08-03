import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { AuthorizationError, primaryRole } from "./auth.js";
import { StoreConflictError, StoreNotFoundError } from "./store.js";
import type {
  AuthPrincipal,
  CaseCommand,
  CaseEvent,
  CaseEventType,
  CaseMeta,
  CaseStage,
  CommandResult,
  HospitalRequest,
} from "./types.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-local";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const casePk = (caseId: string) => `CASE#${caseId}`;
const eventSk = (occurredAt: string, eventId: string) => `EVENT#${occurredAt}#${eventId}`;
const requestSk = (requestId: string) => `HOSPITAL_REQUEST#${requestId}`;
const idempotencySk = (commandId: string) => `IDEMPOTENCY#${commandId}`;
const META_SK = "META";

const EVENT_SUMMARIES: Record<CaseEventType, string> = {
  CASE_ASSIGNED: "사건이 구급대에 배정되었습니다.",
  DISPATCH_STARTED: "출동을 시작했습니다.",
  ARRIVED_SCENE: "현장에 도착했습니다.",
  PATIENT_CONTACT: "환자 접촉을 확인했습니다.",
  PATIENT_FACTS_CONFIRMED: "구급대원이 환자 정보를 확인했습니다.",
  HOSPITAL_REQUEST_CREATED: "병원에 수용 문의를 전달했습니다.",
  HOSPITAL_REQUEST_VIEWED: "병원 담당자가 수용 문의를 열람했습니다.",
  ADDITIONAL_INFO_REQUESTED: "병원에서 추가 정보를 요청했습니다.",
  ADDITIONAL_INFO_SENT: "구급대가 추가 정보를 전달했습니다.",
  HOSPITAL_RESPONSE_RECORDED: "병원 회신이 기록되었습니다.",
  DESTINATION_CONFIRMED_BY_PARAMEDIC: "구급대원이 이송지를 확정했습니다.",
  TRANSPORT_STARTED: "병원 이송을 시작했습니다.",
  REASSESSMENT_CONFIRMED: "이송 중 재평가를 확인했습니다.",
  ARRIVED_HOSPITAL: "병원에 도착했습니다.",
  HANDOFF_SENT: "환자 인계 정보를 전달했습니다.",
  HANDOFF_ACCEPTED: "병원 인수자가 인계를 확인했습니다.",
  REPORT_DRAFTED: "구급활동일지 초안을 생성했습니다.",
  REPORT_REVIEWED: "구급활동일지 검토를 저장했습니다.",
  REPORT_FINALIZED: "구급활동일지를 최종 확정했습니다.",
  FHIR_PUBLISHED: "확정된 인계 정보를 FHIR로 발행했습니다.",
};

function isStage(stage: unknown): stage is CaseStage {
  return typeof stage === "string";
}

function metaFromItem(item: Record<string, unknown> | undefined): CaseMeta | undefined {
  if (!item || item.entityType !== "CASE_META" || typeof item.caseId !== "string") return undefined;
  return {
    caseId: item.caseId,
    version: typeof item.version === "number" ? item.version : 0,
    stage: isStage(item.stage) ? item.stage : "ASSIGNED",
    assignedParamedicIds: Array.isArray(item.assignedParamedicIds) ? item.assignedParamedicIds.filter((v): v is string => typeof v === "string") : [],
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    ...(typeof item.scenario === "string" ? { scenario: item.scenario } : {}),
    ...(typeof item.agency === "string" ? { agency: item.agency } : {}),
    ...(typeof item.unitId === "string" ? { unitId: item.unitId } : {}),
    ...(typeof item.vehicleNumber === "string" ? { vehicleNumber: item.vehicleNumber } : {}),
    ...(typeof item.destinationHospitalId === "string" ? { destinationHospitalId: item.destinationHospitalId } : {}),
  };
}

function eventFromItem(item: Record<string, unknown>): CaseEvent | null {
  if (item.entityType !== "CASE_EVENT" || typeof item.eventId !== "string") return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...event } = item;
  return event as CaseEvent;
}

function requestFromItem(item: Record<string, unknown>): HospitalRequest | null {
  if (item.entityType !== "HOSPITAL_REQUEST" || typeof item.requestId !== "string") return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...request } = item;
  return request as HospitalRequest;
}

export async function getCaseMeta(caseId: string) {
  const response = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: META_SK },
    ConsistentRead: true,
  }));
  return metaFromItem(response.Item);
}

async function getHospitalRequest(caseId: string, requestId: string) {
  const response = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: requestSk(requestId) },
    ConsistentRead: true,
  }));
  return response.Item ? requestFromItem(response.Item) : null;
}

export async function getWorkflowCase(caseId: string) {
  const response = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": casePk(caseId) },
    ConsistentRead: true,
  }));
  const items = response.Items ?? [];
  return {
    meta: metaFromItem(items.find((item) => item.SK === META_SK)),
    events: items.map(eventFromItem).filter((item): item is CaseEvent => item !== null)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-100),
    hospitalRequests: items.map(requestFromItem).filter((item): item is HospitalRequest => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function assertCaseAccess(principal: AuthPrincipal, caseId: string) {
  const { meta, hospitalRequests } = await getWorkflowCase(caseId);
  if (!meta) throw new StoreNotFoundError("사건을 찾을 수 없습니다.");
  if (principal.roles.includes("admin") || principal.roles.includes("control")) return;
  if (principal.roles.includes("paramedic") && meta.assignedParamedicIds.includes(principal.sub)) return;
  if (principal.roles.includes("hospital") && principal.hospitalId
    && (meta.destinationHospitalId
      ? meta.destinationHospitalId === principal.hospitalId
      : hospitalRequests.some((request) => request.hospitalId === principal.hospitalId))) return;
  throw new AuthorizationError("이 사건에 접근할 권한이 없습니다.");
}

function nextStage(current: CaseStage | undefined, type: CaseEventType): CaseStage {
  const keep = () => current ?? "ASSIGNED";
  switch (type) {
    case "CASE_ASSIGNED":
      if (current) throw new StoreConflictError("이미 배정된 사건입니다.");
      return "ASSIGNED";
    case "DISPATCH_STARTED":
      if (current !== "ASSIGNED") throw new StoreConflictError("배정 상태에서만 출동을 시작할 수 있습니다.");
      return "DISPATCHING";
    case "ARRIVED_SCENE":
      if (current !== "DISPATCHING") throw new StoreConflictError("출동 중 상태에서만 현장 도착을 기록할 수 있습니다.");
      return "ON_SCENE";
    case "PATIENT_CONTACT":
      if (current !== "ON_SCENE") throw new StoreConflictError("현장 도착 후 환자 접촉을 기록할 수 있습니다.");
      return "PATIENT_CONTACT";
    case "PATIENT_FACTS_CONFIRMED":
      if (!current || !["PATIENT_CONTACT", "ASSESSING"].includes(current)) throw new StoreConflictError("환자 접촉 후 정보를 확인할 수 있습니다.");
      return "ASSESSING";
    case "HOSPITAL_REQUEST_CREATED":
      if (!current || !["ASSESSING", "HOSPITAL_REQUESTED"].includes(current)) throw new StoreConflictError("환자 확인 후 병원에 문의할 수 있습니다.");
      return "HOSPITAL_REQUESTED";
    case "DESTINATION_CONFIRMED_BY_PARAMEDIC":
      if (current !== "HOSPITAL_REQUESTED") throw new StoreConflictError("병원 회신 후 이송지를 확정할 수 있습니다.");
      return "DESTINATION_CONFIRMED";
    case "TRANSPORT_STARTED":
      if (current !== "DESTINATION_CONFIRMED") throw new StoreConflictError("이송지 확정 후 이송을 시작할 수 있습니다.");
      return "TRANSPORTING";
    case "ARRIVED_HOSPITAL":
      if (current !== "TRANSPORTING") throw new StoreConflictError("이송 중 상태에서만 병원 도착을 기록할 수 있습니다.");
      return "ARRIVED_HOSPITAL";
    case "HANDOFF_SENT":
      if (current !== "ARRIVED_HOSPITAL") throw new StoreConflictError("병원 도착 후 인계할 수 있습니다.");
      return "HANDOFF";
    case "HANDOFF_ACCEPTED":
      if (current !== "HANDOFF") throw new StoreConflictError("인계 정보 전달 후 인수 확인을 기록할 수 있습니다.");
      return "COMPLETE";
    default:
      return keep();
  }
}

function requireParamedicAssignment(principal: AuthPrincipal, meta: CaseMeta | undefined, type: CaseEventType) {
  if (principal.roles.includes("admin") || !principal.roles.includes("paramedic")) return;
  if (type === "CASE_ASSIGNED") return;
  if (!meta?.assignedParamedicIds.includes(principal.sub)) throw new AuthorizationError("이 사건에 배정된 구급대원이 아닙니다.");
}

function updatedHospitalRequest(
  type: CaseEventType,
  command: CaseCommand,
  existing: HospitalRequest | null,
  principal: AuthPrincipal,
  occurredAt: string,
): HospitalRequest | undefined {
  const payload = command.payload;
  if (type === "HOSPITAL_REQUEST_CREATED") {
    if (existing) throw new StoreConflictError("같은 병원 문의 번호가 이미 존재합니다.");
    return {
      requestId: String(payload.requestId),
      caseId: "",
      hospitalId: String(payload.hospitalId),
      ...(typeof payload.hospitalName === "string" ? { hospitalName: payload.hospitalName } : {}),
      status: "REQUESTED",
      requestedBy: principal.sub,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  }
  if (![
    "HOSPITAL_REQUEST_VIEWED",
    "ADDITIONAL_INFO_REQUESTED",
    "ADDITIONAL_INFO_SENT",
    "HOSPITAL_RESPONSE_RECORDED",
    "HANDOFF_ACCEPTED",
  ].includes(type)) return undefined;
  if (!existing) throw new StoreNotFoundError("병원 수용 문의를 찾을 수 없습니다.");
  if (principal.roles.includes("hospital") && principal.hospitalId !== existing.hospitalId) {
    throw new AuthorizationError("다른 병원의 수용 문의에는 회신할 수 없습니다.");
  }

  if (["ACCEPTED", "DECLINED", "CANCELLED"].includes(existing.status) && type !== "HANDOFF_ACCEPTED") {
    throw new StoreConflictError("최종 회신된 수용 문의 상태는 변경할 수 없습니다.");
  }

  if (type === "HOSPITAL_REQUEST_VIEWED") return { ...existing, status: "VIEWED", updatedAt: occurredAt };
  if (type === "ADDITIONAL_INFO_REQUESTED") return {
    ...existing,
    status: "INFO_REQUESTED",
    updatedAt: occurredAt,
    informationRequest: { message: String(payload.message), requestedBy: principal.sub, requestedAt: occurredAt },
  };
  if (type === "ADDITIONAL_INFO_SENT") return { ...existing, status: "INFO_SENT", updatedAt: occurredAt };
  if (type === "HOSPITAL_RESPONSE_RECORDED") {
    if (["ACCEPTED", "DECLINED"].includes(existing.status)) throw new StoreConflictError("이미 최종 회신된 문의입니다.");
    const decision = payload.decision as "ACCEPTED" | "DECLINED";
    return {
      ...existing,
      status: decision,
      updatedAt: occurredAt,
      response: {
        decision,
        respondedBy: principal.sub,
        respondedAt: occurredAt,
        ...(typeof payload.reasonCode === "string" ? { reasonCode: payload.reasonCode } : {}),
        ...(typeof payload.reasonText === "string" ? { reasonText: payload.reasonText } : {}),
      },
    };
  }
  return existing;
}

export async function executeCaseCommand(caseId: string, command: CaseCommand, principal: AuthPrincipal): Promise<CommandResult> {
  const idempotencyKey = { PK: casePk(caseId), SK: idempotencySk(command.commandId) };
  const previous = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: idempotencyKey, ConsistentRead: true }));
  if (previous.Item?.result) return previous.Item.result as CommandResult;

  const meta = await getCaseMeta(caseId);
  requireParamedicAssignment(principal, meta, command.type);
  if (command.expectedVersion !== undefined && command.expectedVersion !== (meta?.version ?? 0)) {
    throw new StoreConflictError("사건 상태가 갱신되었습니다. 최신 상태를 다시 불러오세요.");
  }

  const requestId = typeof command.payload.requestId === "string" ? command.payload.requestId : undefined;
  const existingRequest = requestId ? await getHospitalRequest(caseId, requestId) : null;
  if (command.type === "DESTINATION_CONFIRMED_BY_PARAMEDIC") {
    if (!existingRequest || existingRequest.status !== "ACCEPTED") throw new StoreConflictError("수용 가능 회신을 받은 병원만 이송지로 확정할 수 있습니다.");
    if (existingRequest.hospitalId !== command.payload.hospitalId) throw new StoreConflictError("문의 병원과 이송지 병원이 일치하지 않습니다.");
  }
  if (command.type === "HANDOFF_ACCEPTED") {
    if (!existingRequest || existingRequest.status !== "ACCEPTED") {
      throw new StoreConflictError("수용 가능 회신을 한 최종 이송병원만 환자 인수를 확인할 수 있습니다.");
    }
    if (!meta?.destinationHospitalId || meta.destinationHospitalId !== existingRequest.hospitalId) {
      throw new StoreConflictError("최종 이송병원과 인수 확인 병원이 일치하지 않습니다.");
    }
  }

  const occurredAt = new Date().toISOString();
  const eventId = randomUUID();
  const version = (meta?.version ?? 0) + 1;
  const stage = nextStage(meta?.stage, command.type);
  const role = primaryRole(principal);
  const event: CaseEvent = {
    eventId,
    caseId,
    type: command.type,
    actorSub: principal.sub,
    actorRole: role,
    occurredAt,
    version,
    summary: EVENT_SUMMARIES[command.type],
    payload: command.payload,
  };
  const assignedParamedicIds = command.type === "CASE_ASSIGNED"
    ? command.payload.assignedParamedicIds as string[]
    : meta?.assignedParamedicIds ?? [];
  const nextMeta: CaseMeta = {
    caseId,
    version,
    stage,
    assignedParamedicIds,
    createdAt: meta?.createdAt ?? occurredAt,
    updatedAt: occurredAt,
    ...(meta?.scenario ? { scenario: meta.scenario } : {}),
    ...(command.type === "CASE_ASSIGNED" && typeof command.payload.scenario === "string" ? { scenario: command.payload.scenario } : {}),
    ...(meta?.agency ? { agency: meta.agency } : {}),
    ...(meta?.unitId ? { unitId: meta.unitId } : {}),
    ...(meta?.vehicleNumber ? { vehicleNumber: meta.vehicleNumber } : {}),
    ...(command.type === "CASE_ASSIGNED" && typeof command.payload.agency === "string" ? { agency: command.payload.agency } : {}),
    ...(command.type === "CASE_ASSIGNED" && typeof command.payload.unitId === "string" ? { unitId: command.payload.unitId } : {}),
    ...(command.type === "CASE_ASSIGNED" && typeof command.payload.vehicleNumber === "string" ? { vehicleNumber: command.payload.vehicleNumber } : {}),
    ...(meta?.destinationHospitalId ? { destinationHospitalId: meta.destinationHospitalId } : {}),
    ...(command.type === "DESTINATION_CONFIRMED_BY_PARAMEDIC" ? { destinationHospitalId: String(command.payload.hospitalId) } : {}),
  };
  const result: CommandResult = { caseId, version, eventId, eventType: command.type, occurredAt };
  const ttl = Math.floor(Date.now() / 1_000) + 86_400;
  const request = updatedHospitalRequest(command.type, command, existingRequest, principal, occurredAt);
  if (request) request.caseId = caseId;

  const metaCondition = meta ? "#version = :expected" : "attribute_not_exists(PK)";
  const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(caseId), SK: META_SK, entityType: "CASE_META", ...nextMeta },
        ConditionExpression: metaCondition,
        ...(meta ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": meta.version } } : {}),
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(caseId), SK: eventSk(occurredAt, eventId), entityType: "CASE_EVENT", ...event },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { ...idempotencyKey, entityType: "IDEMPOTENCY", result, expiresAt: ttl },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];
  if (request) {
    items.push({
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(caseId), SK: requestSk(request.requestId), entityType: "HOSPITAL_REQUEST", ...request },
        ConditionExpression: existingRequest ? "updatedAt = :previousUpdatedAt" : "attribute_not_exists(PK)",
        ...(existingRequest ? { ExpressionAttributeValues: { ":previousUpdatedAt": existingRequest.updatedAt } } : {}),
      },
    });
  }

  try {
    await client.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (error) {
    if (error instanceof Error && ["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error.name)) {
      const duplicate = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: idempotencyKey, ConsistentRead: true }));
      if (duplicate.Item?.result) return duplicate.Item.result as CommandResult;
      throw new StoreConflictError("동시 갱신 충돌이 발생했습니다. 최신 상태를 다시 불러오세요.");
    }
    throw error;
  }
  return result;
}

export async function appendInternalEvent(
  caseId: string,
  type: "REPORT_DRAFTED" | "REPORT_REVIEWED" | "REPORT_FINALIZED" | "FHIR_PUBLISHED" | "PATIENT_FACTS_CONFIRMED" | "REASSESSMENT_CONFIRMED",
  actorSub: string,
  actorRole: "paramedic" | "admin",
  payload: Record<string, unknown>,
  commandId: string = randomUUID(),
) {
  const meta = await getCaseMeta(caseId);
  if (!meta) throw new StoreNotFoundError("사건을 찾을 수 없습니다.");
  const command: CaseCommand = { commandId, type, expectedVersion: meta.version, payload };
  return executeCaseCommand(caseId, command, { sub: actorSub, roles: [actorRole] });
}
