import assert from "node:assert/strict";
import test from "node:test";
import { parseKakaoDirections } from "../src/external/kakao.js";
import { validRouteCoordinate, validateRouteReferenceRequest } from "../src/external/routeReferenceService.js";

test("parses distance, rounded-up ETA and Kakao road vertices", () => {
  const result = parseKakaoDirections({
    routes: [{
      result_code: 0,
      summary: { distance: 1_920, duration: 301 },
      sections: [{ roads: [{ vertexes: [128.59, 38.21, 128.591, 38.205] }] }],
    }],
  });

  assert.deepEqual(result, {
    distanceKm: 1.92,
    etaMinutes: 6,
    path: [
      { longitude: 128.59, latitude: 38.21 },
      { longitude: 128.591, latitude: 38.205 },
    ],
  });
});

test("rejects unsuccessful route results and invalid coordinates", () => {
  assert.equal(parseKakaoDirections({ routes: [{ result_code: 104 }] }), null);
  assert.equal(validRouteCoordinate({ latitude: 38.2, longitude: 128.5 }), true);
  assert.equal(validRouteCoordinate({ latitude: 138.2, longitude: 128.5 }), false);
});

test("requires a case-bound JSON route request with valid coordinates", () => {
  const valid = validateRouteReferenceRequest({
    case_id: "GW-CARDIO-051",
    origin: { latitude: 38.207, longitude: 128.591 },
    destination: { latitude: 38.198, longitude: 128.577 },
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.caseId, "GW-CARDIO-051");

  const missingCase = validateRouteReferenceRequest({
    origin: { latitude: 38.207, longitude: 128.591 },
    destination: { latitude: 38.198, longitude: 128.577 },
  });
  assert.equal(missingCase.ok, false);

  const invalidCoordinate = validateRouteReferenceRequest({
    case_id: "GW-CARDIO-051",
    origin: { latitude: 138.207, longitude: 128.591 },
    destination: { latitude: 38.198, longitude: 128.577 },
  });
  assert.equal(invalidCoordinate.ok, false);
});
