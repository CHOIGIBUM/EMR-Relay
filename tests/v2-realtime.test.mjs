import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GraphQLEmsV2Api } from "../lib/v2/api.ts";

const HTTP_ENDPOINT = "https://example.appsync-api.ap-northeast-2.amazonaws.com/graphql";
const REALTIME_ENDPOINT = "wss://example.appsync-realtime-api.ap-northeast-2.amazonaws.com/graphql";

class FakeSocket {
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  sent = [];
  closed = null;

  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) { this.closed = { code, reason }; }
  open() { this.onopen?.(); }
  message(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function decodeHeaderProtocol(value) {
  const encoded = value.slice("header-".length).replace(/-/g, "+").replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

test("opens one Cognito-authenticated AppSync socket and registers each paramedic case", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  const sockets = [];
  let socketUrl = "";
  let socketProtocols = [];
  const statuses = [];
  const updates = [];
  const api = new GraphQLEmsV2Api({
    endpoint: HTTP_ENDPOINT,
    realtimeEndpoint: REALTIME_ENDPOINT,
    getAccessToken: async () => "header.payload.signature",
    webSocketFactory: (url, protocols) => {
      socketUrl = url;
      socketProtocols = protocols;
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });

  try {
    const stop = api.watchUpdates(
      { role: "paramedic", caseIds: ["GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-001"] },
      (update) => updates.push(update),
      (status) => statuses.push(status),
    );
    await nextTurn();

    assert.equal(socketUrl, REALTIME_ENDPOINT);
    assert.deepEqual(socketProtocols.slice(0, 1), ["graphql-ws"]);
    assert.equal(socketUrl.includes("header.payload.signature"), false, "JWT must not be placed in the URL");
    assert.deepEqual(decodeHeaderProtocol(socketProtocols[1]), {
      Authorization: "header.payload.signature",
      host: "example.appsync-api.ap-northeast-2.amazonaws.com",
    });

    const socket = sockets[0];
    socket.open();
    assert.deepEqual(socket.sent[0], { type: "connection_init" });
    socket.message({ type: "connection_ack", payload: { connectionTimeoutMs: 60_000 } });

    const starts = socket.sent.filter(({ type }) => type === "start");
    assert.equal(starts.length, 2, "duplicate case IDs must not create duplicate subscriptions");
    const registrations = starts.map((message) => JSON.parse(message.payload.data));
    assert.deepEqual(registrations.map(({ variables }) => variables.caseId).sort(), ["GW-STROKE-001", "GW-STROKE-002"]);
    assert.equal(registrations.every(({ query }) => query.includes("onCaseUpdate")), true);
    assert.equal(starts.every((message) => message.payload.extensions.authorization.Authorization === "header.payload.signature"), true);

    for (const message of starts) socket.message({ id: message.id, type: "start_ack" });
    assert.equal(statuses.at(-1), "connected");

    socket.message({
      id: starts[0].id,
      type: "data",
      payload: {
        data: {
          onCaseUpdate: {
            caseId: "GW-STROKE-001",
            version: 4,
            eventId: "EVENT-004",
            eventType: "HOSPITAL_RESPONSE_RECORDED",
            stage: "HOSPITAL_REQUESTED",
            occurredAt: "2026-08-05T06:30:00.000Z",
            hospitalId: "A2200012",
            requestStatus: "ACCEPTED",
          },
        },
      },
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].requestStatus, "ACCEPTED");

    stop();
    assert.equal(socket.sent.filter(({ type }) => type === "stop").length, 2);
    assert.deepEqual(socket.closed, { code: 1000, reason: "client stop" });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("registers the authenticated hospital inbox scope", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let socket;
  const api = new GraphQLEmsV2Api({
    endpoint: HTTP_ENDPOINT,
    getAccessToken: async () => "hospital.jwt.token",
    webSocketFactory: () => (socket = new FakeSocket()),
  });

  try {
    const stop = api.watchUpdates({ role: "hospital", hospitalId: "A2200012" }, () => undefined);
    await nextTurn();
    socket.open();
    socket.message({ type: "connection_ack", payload: { connectionTimeoutMs: 60_000 } });
    const registration = socket.sent.find(({ type }) => type === "start");
    const operation = JSON.parse(registration.payload.data);
    assert.equal(operation.query.includes("onHospitalInbox"), true);
    assert.deepEqual(operation.variables, { hospitalId: "A2200012" });
    stop();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("keeps the two-second polling path only while realtime is unavailable", () => {
  const source = readFileSync(new URL("../components/v2/V2Provider.tsx", import.meta.url), "utf8");
  assert.match(source, /realtimeStatus === "connected"/);
  assert.match(source, /window\.setInterval\([\s\S]*?2_000\)/);
  assert.match(source, /api\.watchUpdates\(/);
  assert.match(source, /auth\.user\?\.institutionId/);
});
