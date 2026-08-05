import type { Hospital } from "./types";

/**
 * Receiving institutions for the three demo scenes are keyed by NMC HPID.
 * Names, addresses, and coordinates were read from the live NMC/HIRA reference
 * pipeline on 2026-08-05. Acceptance still comes only from the hospital reply.
 */
export const V2_DEMO_HOSPITALS: readonly Hospital[] = [
  {
    id: "A2200012",
    name: "강원특별자치도속초의료원",
    address: "강원특별자치도 속초시 영랑호반길 3 (영랑동)",
    location: { latitude: 38.2160548810401, longitude: 128.587890296729 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200046",
    name: "의료법인온세움의료재단온재병원",
    address: "강원특별자치도 속초시 중앙로 11 (교동)",
    location: { latitude: 38.198021245336555, longitude: 128.57838660480326 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200010",
    name: "의산의료재단강릉고려병원",
    address: "강원특별자치도 강릉시 옥가로 30 (옥천동)",
    location: { latitude: 37.75910092005996, longitude: 128.89982468955142 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200011",
    name: "강원특별자치도강릉의료원",
    address: "강원특별자치도 강릉시 경강로 2007 (남문동)",
    location: { latitude: 37.7497052078886, longitude: 128.888754154175 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200005",
    name: "의료법인강릉동인병원",
    address: "강원특별자치도 강릉시 강릉대로419번길 42 (포남동)",
    location: { latitude: 37.77432579461282, longitude: 128.90714180258507 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200008",
    name: "강릉아산병원",
    address: "강원특별자치도 강릉시 사천면 방동길 38",
    location: { latitude: 37.818426685036066, longitude: 128.85771413305145 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200038",
    name: "근로복지공단동해병원",
    address: "강원특별자치도 동해시 하평로 11 (평릉동)",
    location: { latitude: 37.53232311891651, longitude: 129.1058560226859 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200003",
    name: "의료법인동해동인병원",
    address: "강원특별자치도 동해시 하평로 26 (평릉동)",
    location: { latitude: 37.530588089816, longitude: 129.107133467362 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200007",
    name: "강원특별자치도삼척의료원",
    address: "강원특별자치도 삼척시 오십천로 473 (정상동)",
    location: { latitude: 37.44027922704624, longitude: 129.16370014395005 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
] as const;

export const DEFAULT_V2_HOSPITAL_ID = V2_DEMO_HOSPITALS[0].id;

/**
 * The integrated demo account is limited to institutions returned for the
 * three configured scenes. This controls only the switcher UX; the API enforces
 * the same membership independently.
 */
export const V2_HOSPITAL_NETWORK_ID = "NETWORK";
export const V2_NETWORK_HOSPITAL_IDS = V2_DEMO_HOSPITALS.map(({ id }) => id);

export function isV2NetworkHospitalId(hospitalId: string) {
  return V2_NETWORK_HOSPITAL_IDS.includes(hospitalId);
}
