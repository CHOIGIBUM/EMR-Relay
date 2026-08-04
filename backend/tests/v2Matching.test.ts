import assert from "node:assert/strict";
import test from "node:test";
import { nextWaveRadius, selectWaveCandidates, shouldStopExpansion } from "../src/v2/matchingPolicy.js";

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

test("expands gradually and never confirms a destination from the first YES", () => {
  assert.equal(nextWaveRadius(15, 120), 30);
  assert.equal(nextWaveRadius(80, 120), 120);
  assert.equal(nextWaveRadius(120, 120), null);
  assert.equal(shouldStopExpansion({ acceptedRequestCount: 1 }), true);
  assert.equal(shouldStopExpansion({ acceptedRequestCount: 0 }), false);
  assert.equal(shouldStopExpansion({ destinationHospitalId: "H1", acceptedRequestCount: 0 }), true);
});
