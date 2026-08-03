import { ApiGatewayManagementApiClient, DeleteConnectionCommand, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { publishFinalizedReportForOutbox } from "./fhir.js";
import { listCaseConnections, removeConnection } from "./realtimeStore.js";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
const management = new ApiGatewayManagementApiClient(endpoint ? { endpoint } : {});
const tableName = process.env.TABLE_NAME || "ems-relay-local";
const document = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

type Invalidation = {
  type: "case.invalidated";
  caseId: string;
  version: number;
  eventType: string;
  occurredAt: string;
};

export async function handler(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    if (record.eventName !== "INSERT" || !record.dynamodb?.NewImage) continue;
    const item = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
    if (item.entityType === "FHIR_OUTBOX" && typeof item.caseId === "string" && typeof item.SK === "string") {
      const actorRole: "admin" | "paramedic" = item.actorRole === "admin" ? "admin" : "paramedic";
      const actorSub = typeof item.requestedBy === "string" ? item.requestedBy : "ems-relay-fhir-outbox";
      const result = await publishFinalizedReportForOutbox(item.caseId, actorSub, actorRole);
      await document.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `CASE#${item.caseId}`, SK: item.SK },
        UpdateExpression: "SET #status = :published, publishedAt = :publishedAt, bundleEntries = :bundleEntries",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":published": "PUBLISHED", ":publishedAt": new Date().toISOString(), ":bundleEntries": result.bundleEntries },
      }));
      continue;
    }
    if (item.entityType !== "CASE_EVENT" || typeof item.caseId !== "string") continue;
    const message: Invalidation = {
      type: "case.invalidated",
      caseId: item.caseId,
      version: typeof item.version === "number" ? item.version : 0,
      eventType: typeof item.type === "string" ? item.type : "UNKNOWN",
      occurredAt: typeof item.occurredAt === "string" ? item.occurredAt : new Date().toISOString(),
    };
    const data = Buffer.from(JSON.stringify(message));
    const connections = await listCaseConnections(item.caseId);
    await Promise.all(connections.map(async (connectionId) => {
      try {
        await management.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (error) {
        const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (statusCode === 410) {
          await removeConnection(connectionId);
          return;
        }
        throw error;
      }
    }));
  }
  return { batchItemFailures: [] };
}

export async function disconnectStale(connectionId: string) {
  await management.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
  await removeConnection(connectionId);
}
