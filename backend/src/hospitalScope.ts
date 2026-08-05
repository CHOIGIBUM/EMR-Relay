import { AuthorizationError } from "./auth.js";
import type { AuthPrincipal } from "./types.js";

export const NETWORK_HOSPITAL_ID = "NETWORK";

export function configuredNetworkHospitalIds(raw = process.env.HOSPITAL_NETWORK_ALLOWED_IDS ?? "") {
  return new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
}

export function canAccessHospital(principal: AuthPrincipal, hospitalId: string) {
  if (!principal.roles.includes("hospital") || !principal.hospitalId) return false;
  if (principal.hospitalId !== NETWORK_HOSPITAL_ID) return principal.hospitalId === hospitalId;
  return configuredNetworkHospitalIds().has(hospitalId);
}

export function resolveHospitalForPrincipal(principal: AuthPrincipal, requestedHospitalId?: string) {
  if (!principal.roles.includes("hospital") || !principal.hospitalId) {
    throw new AuthorizationError("병원 수용 담당자의 기관 정보가 필요합니다.");
  }
  if (principal.hospitalId === NETWORK_HOSPITAL_ID) {
    if (!requestedHospitalId) throw new AuthorizationError("조회할 병원을 선택해 주세요.");
    if (!configuredNetworkHospitalIds().has(requestedHospitalId)) {
      throw new AuthorizationError("허용되지 않은 병원입니다.");
    }
    return requestedHospitalId;
  }
  if (requestedHospitalId && requestedHospitalId !== principal.hospitalId) {
    throw new AuthorizationError("다른 병원의 요청함은 조회할 수 없습니다.");
  }
  return principal.hospitalId;
}
