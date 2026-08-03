import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AuthPrincipal } from "./types.js";

const TABLE_NAME = process.env.CONNECTION_TABLE_NAME || "ems-relay-connections-local";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || "ws://localhost:3001";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const hashTicket = (ticket: string) => createHash("sha256").update(ticket, "utf8").digest("hex");
const ticketPk = (hash: string) => `TICKET#${hash}`;
const connectionPk = (connectionId: string) => `CONNECTION#${connectionId}`;

export type RealtimeTicket = {
  ticketHash: string;
  caseId: string;
  principalSub: string;
  roles: string[];
  hospitalId?: string;
  expiresAt: number;
};

export async function createRealtimeTicket(caseId: string, principal: AuthPrincipal) {
  const ticket = randomBytes(32).toString("base64url");
  const ticketHash = hashTicket(ticket);
  const expiresAt = Math.floor(Date.now() / 1_000) + 300;
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: ticketPk(ticketHash),
      entityType: "REALTIME_TICKET",
      ticketHash,
      caseId,
      principalSub: principal.sub,
      roles: principal.roles,
      ...(principal.hospitalId ? { hospitalId: principal.hospitalId } : {}),
      expiresAt,
    },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  const separator = WEBSOCKET_URL.includes("?") ? "&" : "?";
  return {
    websocketUrl: `${WEBSOCKET_URL}${separator}ticket=${encodeURIComponent(ticket)}`,
    ticket,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  };
}

export async function consumeRealtimeTicket(ticket: string, connectionId: string) {
  if (!ticket || ticket.length > 256) return null;
  const hash = hashTicket(ticket);
  const key = { PK: ticketPk(hash) };
  const response = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }));
  const item = response.Item as RealtimeTicket & Record<string, unknown> | undefined;
  const now = Math.floor(Date.now() / 1_000);
  if (!item || item.entityType !== "REALTIME_TICKET" || item.expiresAt <= now) return null;

  const connectionExpiresAt = now + 7_200;
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: key,
            ConditionExpression: "ticketHash = :hash AND expiresAt > :now",
            ExpressionAttributeValues: { ":hash": hash, ":now": now },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: connectionPk(connectionId),
              entityType: "REALTIME_CONNECTION",
              connectionId,
              caseId: item.caseId,
              principalSub: item.principalSub,
              roles: item.roles,
              ...(item.hospitalId ? { hospitalId: item.hospitalId } : {}),
              connectedAt: new Date().toISOString(),
              expiresAt: connectionExpiresAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") return null;
    throw error;
  }
  return { caseId: item.caseId, principalSub: item.principalSub };
}

export async function removeConnection(connectionId: string) {
  await client.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: connectionPk(connectionId) } }));
}

export async function listCaseConnections(caseId: string) {
  const response = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "CaseIndex",
    KeyConditionExpression: "caseId = :caseId",
    ExpressionAttributeValues: { ":caseId": caseId },
    ProjectionExpression: "connectionId",
  }));
  return (response.Items ?? []).map((item) => item.connectionId).filter((value): value is string => typeof value === "string");
}

