import assert from "node:assert/strict";
import test from "node:test";
import {
  decideExpansion,
  INITIAL_MATCHING_RADIUS_KM,
  MAX_MATCHING_RADIUS_KM,
  nextWaveRadius,
  selectWaveCandidates,
  shouldStopExpansion,
} from "../src/v2/matchingPolicy.js";

test("selects up to three new hospitals in the current radius by ETA", () => {
  const candidates = [
    { hospital_id: "H1", display_name: "A", distance_km: 12, eta_minutes: 18 },
    { hospital_id: "H2", display_name: "B", distance_km: 7, eta_minutes: 14 },
    { hospital_id: "H3", display_name: "C", distance_km: 4, eta_minutes: null },
    { hospital_id: "H4", display_name: "D", distance_km: 9, eta_minutes: 12 },
    { hospital_id: "H5", display_name: "E", distance_km: 31, eta_minutes: 10 },
  ];
  const selected = selectWaveCandidates(candidates, 20, new Set(["H2"]));
  assert.deepEqual(selected.map((item) => item.hospital_id), ["H4", "H1", "H3"]);
});

test("a new wave contains only hospitals newly entering the expanded annulus", () => {
  const candidates = [
    { hospital_id: "H-INNER", display_name: "Inner", distance_km: 8, eta_minutes: 10 },
    { hospital_id: "H-EDGE", display_name: "Edge", distance_km: 15, eta_minutes: 18 },
    { hospital_id: "H-NEW-1", display_name: "New 1", distance_km: 18, eta_minutes: 22 },
    { hospital_id: "H-NEW-2", display_name: "New 2", distance_km: 29, eta_minutes: 31 },
    { hospital_id: "H-OUT", display_name: "Out", distance_km: 31, eta_minutes: 35 },
  ];
  const selected = selectWaveCandidates(candidates, 30, new Set(), 3, 15);
  assert.deepEqual(selected.map((item) => item.hospital_id), ["H-NEW-1", "H-NEW-2"]);
});

test("all declines expand immediately while pending replies wait until the 30 second deadline", () => {
  const nextExpansionAt = "2026-08-05T03:00:30.000Z";
  assert.deepEqual(decideExpansion({
    statuses: ["DECLINED", "DECLINED"],
    nextExpansionAt,
    now: new Date("2026-08-05T03:00:05.000Z"),
  }), { action: "EXPAND", reason: "ALL_DECLINED" });
  assert.deepEqual(decideExpansion({
    statuses: ["DECLINED", "VIEWED"],
    nextExpansionAt,
    now: new Date("2026-08-05T03:00:05.000Z"),
  }), { action: "WAIT", reason: "PENDING_RESPONSES", nextExpansionAt });
  assert.deepEqual(decideExpansion({
    statuses: ["DECLINED", "VIEWED"],
    nextExpansionAt,
    now: new Date("2026-08-05T03:00:31.000Z"),
  }), { action: "EXPAND", reason: "RESPONSE_TIMEOUT" });
  assert.deepEqual(decideExpansion({
    statuses: ["ACCEPTED", "REQUESTED"],
    nextExpansionAt,
  }), { action: "STOP", reason: "ACCEPTED" });
});

test("expands gradually and never confirms a destination from the first YES", () => {
  const radii = [INITIAL_MATCHING_RADIUS_KM];
  for (;;) {
    const next = nextWaveRadius(radii.at(-1) as number, MAX_MATCHING_RADIUS_KM);
    if (next === null) break;
    radii.push(next);
  }
  assert.deepEqual(radii, [15, 30, 60, 120]);
  assert.equal(nextWaveRadius(15, 120), 30);
  assert.equal(nextWaveRadius(80, 120), 120);
  assert.equal(nextWaveRadius(120, 120), null);
  assert.equal(shouldStopExpansion({ acceptedRequestCount: 1 }), true);
  assert.equal(shouldStopExpansion({ acceptedRequestCount: 0 }), false);
  assert.equal(shouldStopExpansion({ destinationHospitalId: "H1", acceptedRequestCount: 0 }), true);
});
