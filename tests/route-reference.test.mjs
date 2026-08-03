import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CARDIO_DEMO_DISPATCH, CARDIO_DEMO_HOSPITALS } from "../lib/cardioDemoData.ts";
import { getLocalRouteReference } from "../lib/localDemoApi.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("uses current public Sokcho addresses and a stored Kakao road snapshot", () => {
  assert.equal(CARDIO_DEMO_DISPATCH.unitBase.name, "영랑119안전센터");
  assert.equal(CARDIO_DEMO_DISPATCH.unitBase.address, "강원특별자치도 속초시 번영로 188");
  assert.equal(CARDIO_DEMO_DISPATCH.location.name, "속초관광수산시장");
  assert.equal(CARDIO_DEMO_DISPATCH.location.displayAddress, "강원특별자치도 속초시 중앙로147번길 16");

  const route = getLocalRouteReference({
    caseId: CARDIO_DEMO_DISPATCH.caseId,
    origin: CARDIO_DEMO_DISPATCH.unitBase,
    destination: CARDIO_DEMO_DISPATCH.location,
  });
  assert.equal(route.distance_km, 1.9);
  assert.equal(route.eta_minutes, 5);
  assert.equal(route.source, "kakao_mobility_snapshot");
  assert.equal(route.is_live, false);
  assert.equal(route.is_road_route, true);
});

test("includes real institution addresses and coordinates in local hospital references", () => {
  assert.deepEqual(CARDIO_DEMO_HOSPITALS.map(({ alias }) => alias), [
    "강원특별자치도속초의료원",
    "강릉아산병원",
    "한림대학교춘천성심병원",
  ]);
  assert.ok(CARDIO_DEMO_HOSPITALS.every((hospital) => hospital.address && hospital.latitude && hospital.longitude));
  assert.ok(CARDIO_DEMO_HOSPITALS.every((hospital) => hospital.replyIsSynthetic));
});

test("does not draw a straight line when a Kakao road path is unavailable", () => {
  const source = readFileSync(path.join(projectRoot, "components", "KakaoRouteMap.tsx"), "utf8");
  assert.doesNotMatch(source, /path:\s*\[start,\s*end\]/);
  assert.match(source, /roadPath\.length > 1/);
});

test("sends precise route coordinates in an authenticated case-bound POST body", () => {
  const source = readFileSync(path.join(projectRoot, "lib", "emsApi.ts"), "utf8");
  const handler = readFileSync(path.join(projectRoot, "backend", "src", "handler.ts"), "utf8");
  assert.match(source, /remotePath:\s*["']route["']/);
  assert.match(source, /method:\s*["']POST["']/);
  assert.match(source, /case_id:\s*caseId/);
  assert.match(source, /body:\s*JSON\.stringify\(requestBody\)/);
  assert.doesNotMatch(source, /origin_lat|destination_lat/);
  assert.match(handler, /method\s*===\s*["']POST["']\s*&&\s*requestPath\s*===\s*["']\/route["']/);
  assert.match(handler, /await assertCaseAccess\(principal, validation\.value\.caseId\)[\s\S]*?getLiveRouteReference/);
});

test("labels arbitrary offline coordinates as a straight-line estimate without an ETA", () => {
  const route = getLocalRouteReference({
    caseId: "GW-CARDIO-999",
    origin: { latitude: 38.1, longitude: 128.1 },
    destination: { latitude: 38.2, longitude: 128.2 },
  });
  assert.equal(route.source, "local_straight_line_estimate");
  assert.equal(route.is_road_route, false);
  assert.equal(route.eta_minutes, null);
  assert.match(route.notice, /실제 도로 경로/);
});
