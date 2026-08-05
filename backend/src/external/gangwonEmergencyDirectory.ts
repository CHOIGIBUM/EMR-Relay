import type { ReferenceFacility } from "./nmc.js";

/**
 * Verified NMC emergency institutions returned across the three configured
 * Gangwon Yeongdong demo scenes on 2026-08-05. The live NMC result overrides
 * these records when available; this baseline keeps progressive radius search
 * useful when the location endpoint returns only the immediate municipality.
 */
export const VERIFIED_GANGWON_EMERGENCY_FACILITIES: readonly ReferenceFacility[] = [
  { id: "A2200012", name: "강원특별자치도속초의료원", address: "강원특별자치도 속초시 영랑호반길 3 (영랑동)", latitude: 38.21622784728713, longitude: 128.5891194514502, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200046", name: "의료법인온세움의료재단온재병원", address: "강원특별자치도 속초시 중앙로 11 (교동)", latitude: 38.198021245336555, longitude: 128.57838660480326, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200010", name: "의산의료재단강릉고려병원", address: "강원특별자치도 강릉시 옥가로 30 (옥천동)", latitude: 37.75910092005996, longitude: 128.89982468955142, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200011", name: "강원특별자치도강릉의료원", address: "강원특별자치도 강릉시 경강로 2007 (남문동)", latitude: 37.74931042017154, longitude: 128.8887963251862, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200005", name: "의료법인강릉동인병원", address: "강원특별자치도 강릉시 강릉대로419번길 42 (포남동)", latitude: 37.77432579461282, longitude: 128.90714180258507, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200008", name: "강릉아산병원", address: "강원특별자치도 강릉시 사천면 방동길 38", latitude: 37.818426685036066, longitude: 128.85771413305145, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200038", name: "근로복지공단동해병원", address: "강원특별자치도 동해시 하평로 11 (평릉동)", latitude: 37.53232311891651, longitude: 129.1058560226859, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200003", name: "의료법인동해동인병원", address: "강원특별자치도 동해시 하평로 26 (평릉동)", latitude: 37.530006805605616, longitude: 129.1074043067605, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
  { id: "A2200007", name: "강원특별자치도삼척의료원", address: "강원특별자치도 삼척시 오십천로 473 (정상동)", latitude: 37.44027922704624, longitude: 129.16370014395005, capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"], sources: ["NMC"] },
] as const;

export function mergeVerifiedGangwonDirectory(live: ReferenceFacility[]) {
  const byId = new Map(VERIFIED_GANGWON_EMERGENCY_FACILITIES.map((facility) => [facility.id, { ...facility }]));
  for (const facility of live) {
    const baseline = byId.get(facility.id);
    byId.set(facility.id, baseline ? {
      ...baseline,
      ...facility,
      capabilities: [...new Set([...baseline.capabilities, ...facility.capabilities])],
      sources: [...new Set([...baseline.sources, ...facility.sources])],
    } : facility);
  }
  return [...byId.values()];
}
