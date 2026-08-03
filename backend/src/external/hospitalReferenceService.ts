import { fetchHiraFacilities } from "./hira.js";
import { fetchKakaoRoute } from "./kakao.js";
import { fetchNmcFacilities, type ReferenceFacility } from "./nmc.js";
import { getExternalApiSecrets } from "./secretProvider.js";

function haversineKm(origin: { latitude: number; longitude: number }, facility: ReferenceFacility) {
  if (facility.latitude === undefined || facility.longitude === undefined) return Number.POSITIVE_INFINITY;
  const rad = (degree: number) => degree * Math.PI / 180;
  const dLat = rad(facility.latitude - origin.latitude);
  const dLng = rad(facility.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(origin.latitude)) * Math.cos(rad(facility.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function facilityNameKey(name: string) {
  return name.replace(/\s+/g, "").toLowerCase();
}

/**
 * NMC emergency institutions are the candidate allowlist. HIRA is used only
 * to enrich a matching NMC institution and can never add a clinic by itself.
 */
export function mergeEmergencyFacilities(nmc: ReferenceFacility[], hira: ReferenceFacility[]) {
  const hiraByName = new Map(hira.map((facility) => [facilityNameKey(facility.name), facility]));
  return nmc.map((facility) => {
    const enrichment = hiraByName.get(facilityNameKey(facility.name));
    if (!enrichment) return facility;
    const latitude = facility.latitude ?? enrichment.latitude;
    const longitude = facility.longitude ?? enrichment.longitude;
    return {
      ...enrichment,
      ...facility,
      id: facility.id,
      capabilities: [...new Set([...facility.capabilities, ...enrichment.capabilities])],
      sources: [...new Set([...facility.sources, ...enrichment.sources])],
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
    };
  });
}

export async function getHospitalReferences(latitude: number, longitude: number) {
  const secrets = await getExternalApiSecrets();
  const origin = { latitude, longitude };
  const settled = await Promise.allSettled([
    fetchNmcFacilities(secrets, latitude, longitude),
    fetchHiraFacilities(secrets, latitude, longitude),
  ]);
  const nmc = settled[0].status === "fulfilled" ? settled[0].value : [];
  const hira = settled[1].status === "fulfilled" ? settled[1].value : [];
  const facilities = mergeEmergencyFacilities(nmc, hira)
    .sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b)).slice(0, 8);

  const hospitals = await Promise.all(facilities.map(async (facility) => {
    const route = facility.latitude !== undefined && facility.longitude !== undefined
      ? await fetchKakaoRoute(secrets, origin, { latitude: facility.latitude, longitude: facility.longitude }).catch(() => null)
      : null;
    const straight = haversineKm(origin, facility);
    return {
      hospital_id: facility.id,
      display_name: facility.name,
      care_level: facility.careLevel ?? "의료기관 기본정보",
      region_label: facility.address ?? "지역 미확인",
      ...(facility.latitude !== undefined ? { latitude: facility.latitude } : {}),
      ...(facility.longitude !== undefined ? { longitude: facility.longitude } : {}),
      distance_km: route?.distanceKm ?? (Number.isFinite(straight) ? Number(straight.toFixed(1)) : 0),
      eta_minutes: route?.etaMinutes ?? 0,
      reference_capabilities: facility.capabilities,
      acceptance_status: "not_provided",
      source: facility.sources.join("+") + (route ? "+KAKAO" : ""),
    };
  }));
  return {
    hospitals,
    reference_at: new Date().toISOString(),
    source: hospitals.length ? "live_reference_apis" : "unavailable",
    notice: "기관·거리·예상 이동시간 참고정보이며 실시간 수용 여부가 아닙니다.",
  };
}
