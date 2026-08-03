import { createHash, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type {
  AgentProposal,
  AuditEvent,
  CaseEvent,
  CaseEventType,
  CaseMeta,
  CaseStage,
  CaseView,
  ConfirmDecision,
  ConfirmedFact,
  ConfirmedState,
  ConfirmRequest,
  DirectFactsRequest,
  FactPath,
  PrincipalRole,
} from "./types.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-local";
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const casePk = (caseId: string) => `CASE#${caseId}`;
const proposalSk = (proposalId: string) => `PROPOSAL#${proposalId}`;
const auditSk = (occurredAt: string, auditId: string) => `AUDIT#${occurredAt}#${auditId}`;
const eventSk = (occurredAt: string, eventId: string) => `EVENT#${occurredAt}#${eventId}`;
const STATE_SK = "STATE#CONFIRMED";
const META_SK = "META";

type ConfirmationActorRole = Extract<PrincipalRole, "paramedic" | "admin">;
type ConfirmationEventType = Extract<CaseEventType, "PATIENT_FACTS_CONFIRMED" | "REASSESSMENT_CONFIRMED">;

export type ConfirmationEventPayload = {
  proposalId: string;
  acceptedPaths: FactPath[];
  rejectedPaths: FactPath[];
  actor: string;
  inputMethod: AgentProposal["source"];
  status: "CONFIRMED";
  version: number;
  kind?: DirectFactsRequest["kind"];
};

export class StoreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreNotFoundError";
  }
}

export class StoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreConflictError";
  }
}

function emptyState(caseId: string): ConfirmedState {
  return { caseId, version: 0, facts: {} };
}

function stateFromItem(caseId: string, item: Record<string, unknown> | undefined): ConfirmedState {
  if (!item) return emptyState(caseId);
  return {
    caseId,
    version: typeof item.version === "number" ? item.version : 0,
    facts: (item.facts ?? {}) as ConfirmedState["facts"],
    ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
    ...(typeof item.updatedAt === "string" ? { updatedAt: item.updatedAt } : {}),
  };
}

function proposalFromItem(item: Record<string, unknown>): AgentProposal | null {
  if (item.entityType !== "PROPOSAL" || typeof item.proposalId !== "string") return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...proposal } = item;
  return proposal as AgentProposal;
}

function auditFromItem(item: Record<string, unknown>): AuditEvent | null {
  if (item.entityType !== "AUDIT" || typeof item.auditId !== "string") return null;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...audit } = item;
  return audit as AuditEvent;
}

function isCaseStage(value: unknown): value is CaseStage {
  return typeof value === "string";
}

function caseMetaFromItem(item: Record<string, unknown> | undefined): CaseMeta | null {
  if (!item || item.entityType !== "CASE_META" || typeof item.caseId !== "string") return null;
  return {
    caseId: item.caseId,
    version: typeof item.version === "number" ? item.version : 0,
    stage: isCaseStage(item.stage) ? item.stage : "ASSIGNED",
    assignedParamedicIds: Array.isArray(item.assignedParamedicIds)
      ? item.assignedParamedicIds.filter((value): value is string => typeof value === "string")
      : [],
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    ...(typeof item.scenario === "string" ? { scenario: item.scenario } : {}),
    ...(typeof item.agency === "string" ? { agency: item.agency } : {}),
    ...(typeof item.unitId === "string" ? { unitId: item.unitId } : {}),
    ...(typeof item.vehicleNumber === "string" ? { vehicleNumber: item.vehicleNumber } : {}),
    ...(typeof item.destinationHospitalId === "string" ? { destinationHospitalId: item.destinationHospitalId } : {}),
  };
}

async function getConfirmationCaseMeta(caseId: string) {
  const response = await documentClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: META_SK },
    ConsistentRead: true,
  }));
  return caseMetaFromItem(response.Item);
}

export async function getConfirmedState(caseId: string) {
  const response = await documentClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: STATE_SK },
    ConsistentRead: true,
  }));
  return stateFromItem(caseId, response.Item);
}

export async function getCase(caseId: string): Promise<CaseView> {
  const response = await documentClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": casePk(caseId) },
    ConsistentRead: true,
  }));

  const items = response.Items ?? [];
  const stateItem = items.find((item) => item.SK === STATE_SK);
  const proposals = items.map(proposalFromItem).filter((item): item is AgentProposal => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const audit = items.map(auditFromItem).filter((item): item is AuditEvent => item !== null)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 50);

  return { caseId, confirmedState: stateFromItem(caseId, stateItem), proposals, audit };
}

export async function saveProposal(proposal: AgentProposal) {
  const audit: AuditEvent = {
    auditId: randomUUID(),
    caseId: proposal.caseId,
    action: "PROPOSAL_CREATED",
    actor: proposal.requestedBy,
    occurredAt: proposal.createdAt,
    proposalId: proposal.proposalId,
    fromVersion: proposal.baseVersion,
    toVersion: proposal.baseVersion,
  };

  await documentClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: casePk(proposal.caseId),
            SK: proposalSk(proposal.proposalId),
            entityType: "PROPOSAL",
            ...proposal,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: casePk(proposal.caseId),
            SK: auditSk(audit.occurredAt, audit.auditId),
            entityType: "AUDIT",
            ...audit,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
  }));
}

async function getProposal(caseId: string, proposalId: string) {
  const response = await documentClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: casePk(caseId), SK: proposalSk(proposalId) },
    ConsistentRead: true,
  }));
  return response.Item ? proposalFromItem(response.Item) : null;
}

export function applyProposalDecisions(
  current: ConfirmedState,
  proposal: AgentProposal,
  decisions: ConfirmDecision[],
  reviewedBy: string,
  confirmedAt: string,
) {
  const byId = new Map(decisions.map((decision) => [decision.changeId, decision]));
  const proposalIds = new Set(proposal.changes.map((change) => change.changeId));
  if (byId.size !== proposal.changes.length || decisions.some((decision) => !proposalIds.has(decision.changeId))) {
    throw new StoreConflictError("모든 변경항목에 대해 한 번씩 승인 또는 제외를 선택해야 합니다.");
  }

  const facts: ConfirmedState["facts"] = { ...current.facts };
  const acceptedPaths: FactPath[] = [];
  const rejectedPaths: FactPath[] = [];

  for (const change of proposal.changes) {
    const decision = byId.get(change.changeId);
    if (!decision) throw new StoreConflictError("변경항목 검토 결과가 누락되었습니다.");
    if (decision.action === "reject") {
      rejectedPaths.push(change.path);
      continue;
    }

    const fact: ConfirmedFact = {
      value: decision.value !== undefined ? decision.value : change.value,
      sourceText: change.sourceText,
      confirmedAt,
      confirmedBy: reviewedBy,
      proposalId: proposal.proposalId,
    };
    if (change.unit !== undefined) fact.unit = change.unit;
    if (change.observedAt !== undefined) fact.observedAt = change.observedAt;
    facts[change.path] = fact;
    acceptedPaths.push(change.path);
  }

  return {
    nextState: {
      caseId: current.caseId,
      version: current.version + 1,
      facts,
      createdAt: current.createdAt ?? confirmedAt,
      updatedAt: confirmedAt,
    } satisfies ConfirmedState,
    acceptedPaths,
    rejectedPaths,
  };
}

const REASSESSMENT_PATHS = new Set<FactPath>([
  "reassessment.systolicBp",
  "reassessment.diastolicBp",
  "reassessment.pulse",
  "reassessment.respiratoryRate",
  "reassessment.spo2",
  "reassessment.temperature",
  "reassessment.glucose",
  "reassessment.avpu",
  "transport.reassessment",
]);

function confirmationEventType(
  acceptedPaths: FactPath[],
  proposal: AgentProposal,
  meta: CaseMeta,
  kind?: DirectFactsRequest["kind"],
): ConfirmationEventType {
  if (kind) return kind === "reassessment" ? "REASSESSMENT_CONFIRMED" : "PATIENT_FACTS_CONFIRMED";
  if (acceptedPaths.some((path) => REASSESSMENT_PATHS.has(path))) return "REASSESSMENT_CONFIRMED";
  // A review that rejects every field still belongs to the proposal's workflow phase.
  if (acceptedPaths.length === 0 && meta.stage === "TRANSPORTING"
    && proposal.changes.some((change) => REASSESSMENT_PATHS.has(change.path))) {
    return "REASSESSMENT_CONFIRMED";
  }
  return "PATIENT_FACTS_CONFIRMED";
}

function nextConfirmationStage(meta: CaseMeta, eventType: ConfirmationEventType): CaseStage {
  if (eventType === "REASSESSMENT_CONFIRMED") return meta.stage;
  if (!["PATIENT_CONTACT", "ASSESSING"].includes(meta.stage)) {
    throw new StoreConflictError("환자 접촉 후 현장 평가 단계에서 환자정보를 확정할 수 있습니다.");
  }
  return "ASSESSING";
}

export type ConfirmationTransactionInput = {
  caseId: string;
  current: ConfirmedState;
  proposal: AgentProposal;
  request: ConfirmRequest;
  meta: CaseMeta;
  actorRole: ConfirmationActorRole;
  kind?: DirectFactsRequest["kind"];
  proposalIsNew?: boolean;
  confirmedAt: string;
  confirmationAuditId: string;
  proposalCreatedAuditId?: string;
  eventId: string;
};

export function buildConfirmationTransaction(input: ConfirmationTransactionInput) {
  const { caseId, current, proposal, request, meta, actorRole, confirmedAt } = input;
  if (proposal.caseId !== caseId) throw new StoreNotFoundError("사건과 변경안이 일치하지 않습니다.");
  if (proposal.status !== "PENDING") throw new StoreConflictError("이미 검토가 끝난 변경안입니다.");
  if (current.version !== request.expectedVersion || proposal.baseVersion !== request.expectedVersion) {
    throw new StoreConflictError("환자정보가 다른 사용자에 의해 갱신되었습니다. 최신 상태를 다시 불러오세요.");
  }

  const { nextState, acceptedPaths, rejectedPaths } = applyProposalDecisions(
    current,
    proposal,
    request.decisions,
    request.reviewedBy,
    confirmedAt,
  );
  const eventType = confirmationEventType(acceptedPaths, proposal, meta, input.kind);
  const workflowVersion = meta.version + 1;
  const nextMeta: CaseMeta = {
    ...meta,
    version: workflowVersion,
    stage: nextConfirmationStage(meta, eventType),
    updatedAt: confirmedAt,
  };
  const payload: ConfirmationEventPayload = {
    proposalId: proposal.proposalId,
    acceptedPaths,
    rejectedPaths,
    actor: request.reviewedBy,
    inputMethod: proposal.source,
    status: "CONFIRMED",
    version: nextState.version,
    ...(input.kind ? { kind: input.kind } : {}),
  };
  const event: CaseEvent = {
    eventId: input.eventId,
    caseId,
    type: eventType,
    actorSub: request.reviewedBy,
    actorRole,
    occurredAt: confirmedAt,
    version: workflowVersion,
    summary: eventType === "REASSESSMENT_CONFIRMED"
      ? "이송 중 재평가를 확인했습니다."
      : "구급대원이 환자 정보를 확인했습니다.",
    payload,
  };
  const audit: AuditEvent = {
    auditId: input.confirmationAuditId,
    caseId,
    action: "PROPOSAL_CONFIRMED",
    actor: request.reviewedBy,
    occurredAt: confirmedAt,
    proposalId: proposal.proposalId,
    fromVersion: current.version,
    toVersion: nextState.version,
    acceptedPaths,
    rejectedPaths,
  };
  const stateCondition = request.expectedVersion === 0
    ? "attribute_not_exists(#version) OR #version = :expected"
    : "#version = :expected";

  const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { PK: casePk(caseId), SK: STATE_SK },
        UpdateExpression: "SET entityType = :entityType, caseId = :caseId, #version = :next, facts = :facts, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt",
        ConditionExpression: stateCondition,
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: {
          ":entityType": "CONFIRMED_STATE",
          ":caseId": caseId,
          ":expected": request.expectedVersion,
          ":next": nextState.version,
          ":facts": nextState.facts,
          ":createdAt": nextState.createdAt,
          ":updatedAt": confirmedAt,
        },
      },
    },
    input.proposalIsNew
      ? {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: casePk(caseId),
              SK: proposalSk(proposal.proposalId),
              entityType: "PROPOSAL",
              ...proposal,
              status: "CONFIRMED",
              confirmedAt,
              confirmedBy: request.reviewedBy,
              decisions: request.decisions,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        }
      : {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: casePk(caseId), SK: proposalSk(proposal.proposalId) },
            UpdateExpression: "SET #status = :confirmed, confirmedAt = :confirmedAt, confirmedBy = :confirmedBy, decisions = :decisions",
            ConditionExpression: "#status = :pending AND baseVersion = :expected",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":confirmed": "CONFIRMED",
              ":confirmedAt": confirmedAt,
              ":confirmedBy": request.reviewedBy,
              ":decisions": request.decisions,
              ":expected": request.expectedVersion,
            },
          },
        },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: casePk(caseId),
          SK: auditSk(audit.occurredAt, audit.auditId),
          entityType: "AUDIT",
          ...audit,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(caseId), SK: META_SK, entityType: "CASE_META", ...nextMeta },
        ConditionExpression: "#version = :expectedWorkflowVersion",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":expectedWorkflowVersion": meta.version },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { PK: casePk(caseId), SK: eventSk(confirmedAt, event.eventId), entityType: "CASE_EVENT", ...event },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];

  if (input.proposalIsNew) {
    if (!input.proposalCreatedAuditId) throw new Error("proposalCreatedAuditId is required for a direct confirmation");
    const createdAudit: AuditEvent = {
      auditId: input.proposalCreatedAuditId,
      caseId,
      action: "PROPOSAL_CREATED",
      actor: proposal.requestedBy,
      occurredAt: proposal.createdAt,
      proposalId: proposal.proposalId,
      fromVersion: proposal.baseVersion,
      toVersion: proposal.baseVersion,
    };
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: casePk(caseId),
          SK: auditSk(createdAudit.occurredAt, createdAudit.auditId),
          entityType: "AUDIT",
          ...createdAudit,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  }

  return { transactItems, confirmedState: nextState, audit, event, nextMeta };
}

async function commitConfirmation(input: ConfirmationTransactionInput) {
  const prepared = buildConfirmationTransaction(input);
  try {
    await documentClient.send(new TransactWriteCommand({ TransactItems: prepared.transactItems }));
  } catch (error) {
    if (error instanceof Error && ["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error.name)) {
      throw new StoreConflictError("동시 갱신 충돌이 발생했습니다. 최신 상태를 다시 불러오세요.");
    }
    throw error;
  }
  return { confirmedState: prepared.confirmedState, audit: prepared.audit };
}

export async function confirmProposal(
  caseId: string,
  request: ConfirmRequest,
  actorRole: ConfirmationActorRole = "paramedic",
) {
  const [current, proposal, meta] = await Promise.all([
    getConfirmedState(caseId),
    getProposal(caseId, request.proposalId),
    getConfirmationCaseMeta(caseId),
  ]);
  if (!proposal) throw new StoreNotFoundError("확인할 변경안을 찾지 못했습니다.");
  if (!meta) throw new StoreNotFoundError("사건을 찾을 수 없습니다.");
  const confirmedAt = new Date().toISOString();
  return commitConfirmation({
    caseId,
    current,
    proposal,
    request,
    meta,
    actorRole,
    confirmedAt,
    confirmationAuditId: randomUUID(),
    eventId: randomUUID(),
  });
}

const DIRECT_FACT_UNITS: Partial<Record<FactPath, string>> = {
  "vitals.systolicBp": "mmHg",
  "vitals.diastolicBp": "mmHg",
  "vitals.pulse": "/min",
  "vitals.respiratoryRate": "/min",
  "vitals.spo2": "%",
  "vitals.temperature": "Cel",
  "vitals.glucose": "mg/dL",
  "reassessment.systolicBp": "mmHg",
  "reassessment.diastolicBp": "mmHg",
  "reassessment.pulse": "/min",
  "reassessment.respiratoryRate": "/min",
  "reassessment.spo2": "%",
  "reassessment.temperature": "Cel",
  "reassessment.glucose": "mg/dL",
};

export async function saveAndConfirmDirectFacts(
  caseId: string,
  request: DirectFactsRequest,
  reviewedBy: string,
  actorRole: ConfirmationActorRole = "paramedic",
) {
  const [current, meta] = await Promise.all([
    getConfirmedState(caseId),
    getConfirmationCaseMeta(caseId),
  ]);
  if (!meta) throw new StoreNotFoundError("사건을 찾을 수 없습니다.");
  if (current.version !== request.expectedVersion) {
    throw new StoreConflictError("환자정보가 다른 사용자에 의해 갱신되었습니다. 최신 상태를 다시 불러오세요.");
  }
  const proposalId = randomUUID();
  const createdAt = new Date().toISOString();
  const proposal: AgentProposal = {
    proposalId,
    caseId,
    status: "PENDING",
    baseVersion: current.version,
    schemaVersion: "1.0",
    summary: "구급대원이 직접 확인한 구조화 입력",
    changes: request.facts.map((fact) => ({
      ...fact,
      changeId: randomUUID(),
      certainty: "clear",
      ...(DIRECT_FACT_UNITS[fact.path] ? { unit: DIRECT_FACT_UNITS[fact.path] } : {}),
    })),
    flags: [],
    transcriptHash: createHash("sha256").update(JSON.stringify(request.facts)).digest("hex"),
    source: "manual",
    requestedBy: reviewedBy,
    createdAt,
  };
  const confirmRequest: ConfirmRequest = {
    proposalId,
    expectedVersion: request.expectedVersion,
    reviewedBy,
    decisions: proposal.changes.map((change) => ({ changeId: change.changeId, action: "accept" })),
  };
  return commitConfirmation({
    caseId,
    current,
    proposal,
    request: confirmRequest,
    meta,
    actorRole,
    kind: request.kind,
    proposalIsNew: true,
    confirmedAt: createdAt,
    confirmationAuditId: randomUUID(),
    proposalCreatedAuditId: randomUUID(),
    eventId: randomUUID(),
  });
}

export function getTableName() {
  return TABLE_NAME;
}
