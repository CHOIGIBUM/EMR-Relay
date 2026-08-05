import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInitialV2Store } from "../lib/v2/fixtures.ts";
import { DEFAULT_V2_HOSPITAL_ID, V2_DEMO_HOSPITALS } from "../lib/v2/hospitalDirectory.ts";

test("uses NMC HPIDs as the canonical IDs for the demo-scene hospital switcher", () => {
  assert.equal(DEFAULT_V2_HOSPITAL_ID, "A2200012");
  assert.deepEqual(V2_DEMO_HOSPITALS.map(({ id }) => id), [
    "A2200012", "A2200046", "A2200010", "A2200011", "A2200005",
    "A2200008", "A2200038", "A2200003", "A2200007",
  ]);
  assert.equal(V2_DEMO_HOSPITALS.find(({ id }) => id === "A2200046")?.name, "의료법인온세움의료재단온재병원");
});

test("keeps every fixture route joinable to the canonical hospital directory", () => {
  const store = createInitialV2Store();
  const ids = new Set(store.hospitals.map(({ id }) => id));
  assert.equal(ids.size, 9);
  assert.equal(ids.has("A2200046"), true);
  assert.equal(store.routes.every(({ hospitalId }) => ids.has(hospitalId)), true);
  assert.equal(store.routes.some(({ hospitalId }) => hospitalId.startsWith("H-GW-EMG-")), false);
});

test("keeps the local fallback route order aligned with live Kakao road results", () => {
  const routes = createInitialV2Store().routes
    .filter(({ caseId }) => caseId === "GW-STROKE-001")
    .map(({ hospitalId, wave, distanceKm, etaMinutes }) => ({ hospitalId, wave, distanceKm, etaMinutes }));
  assert.deepEqual(routes, [
    { hospitalId: "A2200012", wave: 1, distanceKm: 1.8, etaMinutes: 5 },
    { hospitalId: "A2200011", wave: 2, distanceKm: 70.6, etaMinutes: 61 },
    { hospitalId: "A2200003", wave: 3, distanceKm: 105.1, etaMinutes: 84 },
  ]);
});

test("development hospital login uses the same default HPID", () => {
  const source = readFileSync(new URL("../lib/cognitoAuth.ts", import.meta.url), "utf8");
  assert.match(source, /institutionId:\s*role === "hospital" \? DEFAULT_V2_HOSPITAL_ID : null/);
  assert.doesNotMatch(source, /H-GW-EMG-/);
});
