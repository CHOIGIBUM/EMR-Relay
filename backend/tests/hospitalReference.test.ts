import assert from "node:assert/strict";
import test from "node:test";
import { mergeVerifiedGangwonDirectory } from "../src/external/gangwonEmergencyDirectory.js";
import {
  mergeEmergencyFacilities,
  selectNetworkHospitalFacilities,
  sortHospitalReferences,
} from "../src/external/hospitalReferenceService.js";
import type { ReferenceFacility } from "../src/external/nmc.js";

const nmc: ReferenceFacility = {
  id: "NMC-EMERGENCY-1",
  name: "강원 응급의료센터",
  careLevel: "지역응급의료센터",
  capabilities: ["NMC 응급의료기관 참고정보"],
  sources: ["NMC"],
};

test("uses NMC emergency institutions as the candidate allowlist", () => {
  const result = mergeEmergencyFacilities([nmc], [{
    id: "HIRA-CLINIC-1",
    name: "가까운 외과의원",
    careLevel: "의원",
    latitude: 38.1,
    longitude: 128.1,
    capabilities: ["HIRA 의료기관 기본정보"],
    sources: ["HIRA"],
  }]);

  assert.deepEqual(result, [nmc]);
});

test("keeps a verified cross-municipality baseline while live NMC values take precedence", () => {
  const result = mergeVerifiedGangwonDirectory([{
    id: "A2200012",
    name: "속초의료원 실시간 명칭",
    address: "실시간 주소",
    latitude: 38.2,
    longitude: 128.5,
    capabilities: ["실시간 NMC 정보"],
    sources: ["NMC"],
  }]);

  assert.equal(result.length, 9);
  assert.equal(result.find(({ id }) => id === "A2200012")?.name, "속초의료원 실시간 명칭");
  assert.equal(result.some(({ id }) => id === "A2200011"), true);
  assert.equal(result.some(({ id }) => id === "A2200003"), true);
});

test("keeps all nine allowlisted hospitals and excludes non-network candidates", () => {
  const allowedIds = new Set(Array.from({ length: 9 }, (_, index) => `H${index + 1}`));
  const facilities: ReferenceFacility[] = [
    ...[...allowedIds].map((id, index) => ({
      id,
      name: id,
      latitude: 38 + index / 100,
      longitude: 128,
      capabilities: [],
      sources: ["NMC" as const],
    })),
    {
      id: "OUTSIDE-NETWORK",
      name: "Outside",
      latitude: 38,
      longitude: 128,
      capabilities: [],
      sources: ["NMC"],
    },
  ];

  const selected = selectNetworkHospitalFacilities(
    facilities,
    { latitude: 38, longitude: 128 },
    allowedIds,
  );
  assert.equal(selected.length, 9);
  assert.deepEqual(new Set(selected.map(({ id }) => id)), allowedIds);
});

test("enriches a matching NMC institution without replacing its identity or care level", () => {
  const result = mergeEmergencyFacilities([nmc], [{
    id: "HIRA-INTERNAL-ID",
    name: "강원응급의료센터",
    careLevel: "종합병원",
    latitude: 38.2,
    longitude: 128.2,
    capabilities: ["HIRA 의료기관 기본정보"],
    sources: ["HIRA"],
  }]);

  assert.equal(result.length, 1);
  const [facility] = result;
  assert.ok(facility);
  assert.equal(facility.id, "NMC-EMERGENCY-1");
  assert.equal(facility.careLevel, "지역응급의료센터");
  assert.equal(facility.latitude, 38.2);
  assert.deepEqual(facility.sources, ["NMC", "HIRA"]);
});

test("orders live road routes by Kakao ETA and keeps straight-line fallbacks last", () => {
  const sorted = sortHospitalReferences([
    { id: "fallback-near", distance_km: 1.2, eta_minutes: null, route_is_live: false, is_road_route: false },
    { id: "live-slow", distance_km: 20, eta_minutes: 38, route_is_live: true, is_road_route: true },
    { id: "live-fast", distance_km: 24, eta_minutes: 27, route_is_live: true, is_road_route: true },
    { id: "fallback-far", distance_km: 8.4, eta_minutes: null, route_is_live: false, is_road_route: false },
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ["live-fast", "live-slow", "fallback-near", "fallback-far"]);
  assert.equal(sorted[2]?.eta_minutes, null);
  assert.equal(sorted[2]?.is_road_route, false);
});
