import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { formatUrl } from "@aws-sdk/util-format-url";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { AuthPrincipal } from "./types.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-local";
const REGION = process.env.TRANSCRIBE_REGION || process.env.AWS_REGION || "us-west-2";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const signer = new SignatureV4({
  credentials: defaultProvider(),
  region: REGION,
  service: "transcribe",
  sha256: Hash.bind(null, "sha256"),
});

export async function createTranscribeSession(caseId: string, principal: AuthPrincipal) {
  const sessionId = randomUUID();
  const expiresIn = 300;
  const expiresAtEpoch = Math.floor(Date.now() / 1_000) + expiresIn;
  const hostname = `transcribestreaming.${REGION}.amazonaws.com`;
  const request = new HttpRequest({
    protocol: "https:",
    hostname,
    port: 8443,
    method: "GET",
    path: "/stream-transcription-websocket",
    headers: { host: `${hostname}:8443` },
    query: {
      "language-code": "ko-KR",
      "media-encoding": "pcm",
      "sample-rate": "16000",
      "session-id": sessionId,
      "enable-partial-results-stabilization": "true",
      "partial-results-stability": "medium",
    },
  });
  const signed = await signer.presign(request, { expiresIn });
  const websocketUrl = formatUrl(signed).replace(/^https:/, "wss:");

  // Only short-lived session metadata is retained. Raw audio and presigned URLs are never stored.
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CASE#${caseId}`,
      SK: `TRANSCRIBE_SESSION#${sessionId}`,
      entityType: "TRANSCRIBE_SESSION",
      sessionId,
      caseId,
      requestedBy: principal.sub,
      languageCode: "ko-KR",
      mediaEncoding: "pcm",
      sampleRateHertz: 16_000,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtEpoch,
    },
    ConditionExpression: "attribute_not_exists(PK)",
  }));

  return {
    sessionId,
    websocketUrl,
    expiresAt: new Date(expiresAtEpoch * 1_000).toISOString(),
    languageCode: "ko-KR" as const,
    mediaEncoding: "pcm" as const,
    sampleRateHertz: 16_000 as const,
  };
}
