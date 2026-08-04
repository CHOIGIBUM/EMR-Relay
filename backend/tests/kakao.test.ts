import assert from "node:assert/strict";
import test from "node:test";
import { parseKakaoDirections } from "../src/external/kakao.js";

test("parses Kakao road distance, rounded-up ETA, and vertices", () => {
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

test("does not fabricate a route from an unsuccessful Kakao response", () => {
  assert.equal(parseKakaoDirections({ routes: [{ result_code: 104 }] }), null);
  assert.equal(parseKakaoDirections({ routes: [] }), null);
});
