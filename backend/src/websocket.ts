import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { consumeRealtimeTicket, removeConnection } from "./realtimeStore.js";

type WebSocketEvent = {
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext: {
    connectionId: string;
    routeKey: string;
  };
};

const result = (statusCode: number, body = "") : APIGatewayProxyResultV2 => ({ statusCode, body });

export async function handler(event: WebSocketEvent): Promise<APIGatewayProxyResultV2> {
  const { connectionId, routeKey } = event.requestContext;
  if (routeKey === "$connect") {
    const ticket = event.queryStringParameters?.ticket ?? "";
    const session = await consumeRealtimeTicket(ticket, connectionId);
    return session ? result(200, "connected") : result(401, "unauthorized");
  }
  if (routeKey === "$disconnect") {
    await removeConnection(connectionId);
    return result(200, "disconnected");
  }
  return result(200, "ignored");
}
