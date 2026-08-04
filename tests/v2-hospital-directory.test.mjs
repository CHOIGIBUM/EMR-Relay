import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInitialV2Store } from "../lib/v2/fixtures.ts";
import { DEFAULT_V2_HOSPITAL_ID, V2_DEMO_HOSPITALS } from "../lib/v2/hospitalDirectory.ts";

test("uses NMC HPIDs as the canonical IDs for all three hospital accounts", () => {
  assert.equal(DEFAULT_V2_HOSPITAL_ID, "A2200012");
  assert.deepEqual(V2_DEMO_HOSPITALS.map(({ id, name, address }) => ({ id, name, address })), [
    {
      id: "A2200012",
      name: "강원특별자치도속초의료원",
      address: "강원특별자치도 속초시 영랑호반길 3 (영랑동)",
    },
    {
      id: "A2200011",
      name: "강원특별자치도강릉의료원",
      address: "강원특별자치도 강릉시 경강로 2007 (남문동)",
    },
    {
      id: "A2200003",
      name: "의료법인동해동인병원",
      address: "강원특별자치도 동해시 하평로 26 (평릉동)",
    },
  ]);
});

test("keeps every fixture route joinable to the canonical hospital directory", () => {
  const store = createInitialV2Store();
  const ids = new Set(store.hospitals.map(({ id }) => id));
  assert.deepEqual([...ids], ["A2200012", "A2200011", "A2200003"]);
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
