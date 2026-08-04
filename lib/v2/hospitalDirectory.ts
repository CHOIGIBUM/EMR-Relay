import type { Hospital } from "./types";

/**
 * Demo receiving institutions are keyed by the NMC HPID stored in Cognito's
 * custom:hospital_id claim. Names and addresses were verified against the
 * official NMC emergency-institution API; map coordinates use Kakao address
 * search for the same road addresses (verified 2026-08-05).
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
    id: "A2200011",
    name: "강원특별자치도강릉의료원",
    address: "강원특별자치도 강릉시 경강로 2007 (남문동)",
    location: { latitude: 37.7497052078886, longitude: 128.888754154175 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
  {
    id: "A2200003",
    name: "의료법인동해동인병원",
    address: "강원특별자치도 동해시 하평로 26 (평릉동)",
    location: { latitude: 37.530588089816, longitude: 129.107133467362 },
    capabilities: ["NMC 응급의료기관 참고정보", "수용 여부는 병원 회신으로 확인"],
  },
] as const;

export const DEFAULT_V2_HOSPITAL_ID = V2_DEMO_HOSPITALS[0].id;
