import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  AgentProposal,
  AuditEvent,
  CaseView,
  ConfirmDecision,
  ConfirmedFact,
  ConfirmedState,
  ConfirmRequest,
  FactPath,
} from "./types.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-local";
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const casePk = (caseId: string) => `CASE#${caseId}`;
const proposalSk = (proposalId: string) => `PROPOSAL#${proposalId}`;
const auditSk = (occurredAt: string, auditId: string) => `AUDIT#${occurredAt}#${auditId}`;
const STATE_SK = "STATE#CONFIRMED";

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

export async function confirmProposal(caseId: string, request: ConfirmRequest) {
  const [current, proposal] = await Promise.all([
    getConfirmedState(caseId),
    getProposal(caseId, request.proposalId),
  ]);

  if (!proposal) throw new StoreNotFoundError("확인할 변경안을 찾지 못했습니다.");
  if (proposal.caseId !== caseId) throw new StoreNotFoundError("사건과 변경안이 일치하지 않습니다.");
  if (proposal.status !== "PENDING") throw new StoreConflictError("이미 검토가 끝난 변경안입니다.");
  if (current.version !== request.expectedVersion || proposal.baseVersion !== request.expectedVersion) {
    throw new StoreConflictError("환자정보가 다른 사용자에 의해 갱신되었습니다. 최신 상태를 다시 불러오세요.");
  }

  const confirmedAt = new Date().toISOString();
  const { nextState, acceptedPaths, rejectedPaths } = applyProposalDecisions(
    current,
    proposal,
    request.decisions,
    request.reviewedBy,
    confirmedAt,
  );
  const audit: AuditEvent = {
    auditId: randomUUID(),
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

  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
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
        {
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
      ],
    }));
  } catch (error) {
    if (error instanceof Error && ["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error.name)) {
      throw new StoreConflictError("동시 갱신 충돌이 발생했습니다. 최신 상태를 다시 불러오세요.");
    }
    throw error;
  }

  return { confirmedState: nextState, audit };
}

export function getTableName() {
  return TABLE_NAME;
}
