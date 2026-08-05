import assert from "node:assert/strict";
import test from "node:test";
import { GraphQLEmsV2Api, LocalEmsV2Api } from "../lib/v2/api.ts";
import { createInitialV2Store } from "../lib/v2/fixtures.ts";
import { DEMO_RESET_CONFIRMATION } from "../lib/v2/types.ts";

const ENDPOINT = "https://example.appsync-api.ap-northeast-2.amazonaws.com/graphql";

function graphQlResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function doubleEncode(value) {
  return JSON.stringify(JSON.stringify(value));
}

test("binds the browser fetch receiver and avoids Chromium Illegal invocation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = function browserLikeFetch() {
    calls += 1;
    assert.equal(
      this,
      globalThis,
      "browser fetch must be invoked with globalThis/Window as its receiver",
    );
    return Promise.resolve(graphQlResponse({ listMyCases: [] }));
  };

  try {
    const api = new GraphQLEmsV2Api({ endpoint: ENDPOINT });
    assert.deepEqual(await api.listMyCases(), []);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends the authenticated demo reset through the AppSync mutation contract", async () => {
  let requestBody;
  const api = new GraphQLEmsV2Api({
    endpoint: ENDPOINT,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return graphQlResponse({
        resetDemoCases: {
          caseIds: ["GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-003"],
          deletedItems: 37,
          restoredItems: 12,
          resetAt: "2026-08-05T03:00:00.000Z",
        },
      });
    },
  });

  const result = await api.resetDemoCases(DEMO_RESET_CONFIRMATION);
  assert.equal(requestBody.operationName, "resetDemoCases");
  assert.deepEqual(requestBody.variables, { input: { confirmation: DEMO_RESET_CONFIRMATION } });
  assert.deepEqual(result.caseIds, ["GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-003"]);
  assert.equal(result.restoredItems, 12);
});

test("local demo reset preserves non-demo cases and their requests", async () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  try {
    const store = createInitialV2Store();
    const realCase = structuredClone(store.cases[0]);
    realCase.id = "REAL-CASE-001";
    realCase.code = "REAL-001";
    store.cases.push(realCase);
    store.requests.push(
      {
        id: "REQ-DEMO-OLD",
        caseId: "GW-STROKE-001",
        hospitalId: "A2200012",
        wave: 1,
        status: "ACCEPTED",
        distanceKm: 2,
        etaMinutes: 4,
        requestedAt: "2026-08-05T01:00:00.000Z",
      },
      {
        id: "REQ-REAL-KEEP",
        caseId: "REAL-CASE-001",
        hospitalId: "A2200012",
        wave: 1,
        status: "REQUESTED",
        distanceKm: 3,
        etaMinutes: 6,
        requestedAt: "2026-08-05T01:00:00.000Z",
      },
    );
    localStorage.setItem("ems-relay:v2:local-store", JSON.stringify(store));

    const api = new LocalEmsV2Api();
    await api.resetDemoCases(DEMO_RESET_CONFIRMATION);
    const resetStore = await api.getStore();
    assert.deepEqual(resetStore.cases.filter(({ id }) => id.startsWith("GW-STROKE-")).map(({ id }) => id), [
      "GW-STROKE-001",
      "GW-STROKE-002",
      "GW-STROKE-003",
    ]);
    assert.ok(resetStore.cases.some(({ id }) => id === "REAL-CASE-001"));
    assert.ok(resetStore.requests.some(({ id }) => id === "REQ-REAL-KEEP"));
    assert.ok(!resetStore.requests.some(({ id }) => id === "REQ-DEMO-OLD"));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("decodes double-encoded AppSync AWSJSON event and hospital-request arrays", async () => {
  const caseId = "GW-STROKE-001";
  const requestedAt = "2026-08-05T01:02:03.000Z";
  const api = new GraphQLEmsV2Api({
    endpoint: ENDPOINT,
    fetchImpl: async () => graphQlResponse({
      getCase: {
        caseId,
        version: 7,
        stage: "HOSPITAL_REQUESTED",
        confirmedState: JSON.stringify({ facts: {} }),
        meta: JSON.stringify({ reportTime: "09:12" }),
        events: doubleEncode([
          {
            type: "DISPATCH_STARTED",
            occurredAt: "2026-08-05T00:55:00.000Z",
          },
        ]),
        hospitalRequests: doubleEncode([
          {
            requestId: "REQ-001-A2200012",
            caseId,
            hospitalId: "A2200012",
            hospitalName: "속초의료원",
            status: "ACCEPTED",
            wave: 1,
            distanceKm: 8.4,
            etaMinutes: 13,
            createdAt: requestedAt,
            updatedAt: requestedAt,
          },
        ]),
      },
    }),
  });

  const incident = await api.getCase(caseId);

  assert.equal(incident.stage, "matching");
  assert.equal(incident.timeline.dispatchStartedAt, "2026-08-05T00:55:00.000Z");
  assert.equal(incident.hospitalRequests?.length, 1);
  assert.deepEqual(incident.hospitalRequests?.[0], {
    id: "REQ-001-A2200012",
    caseId,
    hospitalId: "A2200012",
    hospitalName: "속초의료원",
    hospitalAddress: undefined,
    hospitalLocation: undefined,
    wave: 1,
    radiusKm: undefined,
    status: "ACCEPTED",
    distanceKm: 8.4,
    etaMinutes: 13,
    requestedAt,
    viewedAt: undefined,
    respondedAt: requestedAt,
    reason: undefined,
  });
});

test("decodes double-encoded AppSync AWSJSON voice change and flag arrays", async () => {
  const changes = [
    {
      changeId: "CHANGE-001",
      path: "vitals.systolicBp",
      value: 178,
      unit: "mmHg",
      certainty: "clear",
      sourceText: "혈압 178",
    },
  ];
  const flags = [
    {
      code: "HIGH_BP",
      severity: "warning",
      field: "vitals.systolicBp",
      message: "수축기 혈압 재확인 필요",
    },
  ];
  const api = new GraphQLEmsV2Api({
    endpoint: ENDPOINT,
    fetchImpl: async () => graphQlResponse({
      structureVoiceUpdate: {
        proposalId: "PROPOSAL-001",
        caseId: "GW-STROKE-001",
        baseVersion: 7,
        status: "PENDING",
        summary: "활력징후 1건을 인식했습니다.",
        changes: doubleEncode(changes),
        flags: doubleEncode(flags),
        createdAt: "2026-08-05T01:05:00.000Z",
        requiresHumanReview: true,
      },
    }),
  });

  const proposal = await api.structureVoiceUpdate(
    "GW-STROKE-001",
    "혈압 178입니다.",
    "VITALS",
  );

  assert.deepEqual(proposal.changes, changes);
  assert.deepEqual(proposal.flags, flags);
});

test("encodes manual measuredAt as fact observedAt and round-trips the same HH:MM", async () => {
  const caseId = "GW-STROKE-001";
  let confirmedFacts = {};
  let capturedObservedAt;

  const api = new GraphQLEmsV2Api({
    endpoint: ENDPOINT,
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body));

      if (request.operationName === "executeCommand") {
        const commandPayload = JSON.parse(request.variables.input.payload);
        const systolic = commandPayload.facts.find((fact) => fact.path === "vitals.systolicBp");
        assert.ok(systolic, "manual systolic blood pressure must be sent as a fact");
        capturedObservedAt = systolic.observedAt;
        confirmedFacts = Object.fromEntries(commandPayload.facts.map((fact) => [
          fact.path,
          {
            value: fact.value,
            observedAt: fact.observedAt,
            sourceText: fact.sourceText,
          },
        ]));
        return graphQlResponse({
          executeCommand: {
            caseId,
            version: 2,
            eventId: "EVENT-ASSESSMENT-001",
            eventType: "PATIENT_FACTS_CONFIRMED",
            stage: "ASSESSING",
            occurredAt: "2026-08-05T05:26:00.000Z",
            payload: "{}",
          },
        });
      }

      assert.equal(request.operationName, "getCase");
      return graphQlResponse({
        getCase: {
          caseId,
          version: 2,
          stage: "ASSESSING",
          confirmedState: JSON.stringify({ facts: confirmedFacts }),
          meta: "{}",
          events: "[]",
          hospitalRequests: "[]",
        },
      });
    },
  });

  const incident = await api.saveAssessment(caseId, {
    systolicBp: 178,
    diastolicBp: 96,
    measuredAt: "14:26",
  });

  assert.equal(typeof capturedObservedAt, "string");
  const observedDate = new Date(capturedObservedAt);
  assert.equal(observedDate.getHours(), 14);
  assert.equal(observedDate.getMinutes(), 26);
  assert.equal(observedDate.getSeconds(), 0);
  assert.equal(incident.assessment.measuredAt, "14:26");
});
