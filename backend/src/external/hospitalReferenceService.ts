import { fetchHiraFacilities } from "./hira.js";
import { fetchKakaoRoute } from "./kakao.js";
import {
  mergeVerifiedGangwonDirectory,
  VERIFIED_GANGWON_EMERGENCY_FACILITIES,
} from "./gangwonEmergencyDirectory.js";
import { enrichFacilitiesWithNmcRealtime, fetchNmcFacilities, type ReferenceFacility } from "./nmc.js";
import { getExternalApiSecrets } from "./secretProvider.js";
import { configuredNetworkHospitalIds } from "../hospitalScope.js";

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

type RankedHospitalReference = {
  distance_km: number;
  eta_minutes: number | null;
  route_is_live: boolean;
  is_road_route: boolean;
};

/** Live Kakao road routes are ordered by ETA. If Kakao is unavailable, the
 * fallback entries follow in straight-line distance order and expose no ETA. */
export function sortHospitalReferences<T extends RankedHospitalReference>(hospitals: T[]): T[] {
  return [...hospitals].sort((left, right) => {
    const leftLive = left.route_is_live && left.is_road_route && left.eta_minutes !== null;
    const rightLive = right.route_is_live && right.is_road_route && right.eta_minutes !== null;
    if (leftLive !== rightLive) return leftLive ? -1 : 1;
    if (leftLive && rightLive) return (left.eta_minutes as number) - (right.eta_minutes as number);
    return left.distance_km - right.distance_km;
  });
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

export function matchingNetworkHospitalIds(raw = process.env.HOSPITAL_NETWORK_ALLOWED_IDS ?? "") {
  const configured = configuredNetworkHospitalIds(raw);
  return configured.size > 0
    ? configured
    : new Set(VERIFIED_GANGWON_EMERGENCY_FACILITIES.map((facility) => facility.id));
}

export function selectNetworkHospitalFacilities(
  facilities: ReferenceFacility[],
  origin: { latitude: number; longitude: number },
  allowedIds = matchingNetworkHospitalIds(),
) {
  return facilities
    .filter((facility) => allowedIds.has(facility.id))
    .filter((facility) => facility.latitude !== undefined && facility.longitude !== undefined)
    .sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b))
    .slice(0, allowedIds.size);
}

export async function getHospitalReferences(latitude: number, longitude: number) {
  const secrets = await getExternalApiSecrets();
  const origin = { latitude, longitude };
  const settled = await Promise.allSettled([
    fetchNmcFacilities(secrets, latitude, longitude),
    fetchHiraFacilities(secrets, latitude, longitude),
  ]);
  const liveNmc = settled[0].status === "fulfilled" ? settled[0].value : [];
  const nmc = mergeVerifiedGangwonDirectory(liveNmc);
  const hira = settled[1].status === "fulfilled" ? settled[1].value : [];
  const allowedIds = matchingNetworkHospitalIds();
  const candidates = selectNetworkHospitalFacilities(mergeEmergencyFacilities(nmc, hira), origin, allowedIds);
  const discoveryFacilities = hira
    .filter((facility) => facility.latitude !== undefined && facility.longitude !== undefined)
    .filter((facility) => /^(상급종합|종합병원|병원)$/.test(facility.careLevel ?? ""))
    .sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b));
  const realtime = await enrichFacilitiesWithNmcRealtime(
    secrets,
    candidates,
    undefined,
    discoveryFacilities,
  );
  const facilities = selectNetworkHospitalFacilities(realtime.facilities, origin, allowedIds);

  const hospitals = await Promise.all(facilities.map(async (facility) => {
    const route = await fetchKakaoRoute(
      secrets,
      origin,
      { latitude: facility.latitude as number, longitude: facility.longitude as number },
    ).catch(() => null);
    const straight = haversineKm(origin, facility);
    return {
      hospital_id: facility.id,
      display_name: facility.name,
      care_level: facility.careLevel ?? "의료기관 기본정보",
      region_label: facility.address ?? "지역 미확인",
      ...(facility.latitude !== undefined ? { latitude: facility.latitude } : {}),
      ...(facility.longitude !== undefined ? { longitude: facility.longitude } : {}),
      distance_km: route ? Number(route.distanceKm.toFixed(1)) : Number(straight.toFixed(1)),
      eta_minutes: route?.etaMinutes ?? null,
      reference_capabilities: facility.capabilities,
      nmc_realtime_resources: facility.nmcRealtimeResources ?? null,
      acceptance_status: "not_provided",
      source: facility.sources.join("+") + (route ? "+KAKAO" : ""),
      reference_source: facility.sources.join("+"),
      route_source: route ? "kakao_mobility_live" : "local_straight_line_estimate",
      route_is_live: Boolean(route),
      is_road_route: Boolean(route),
    };
  }));
  const degradedSources = [
    ...(settled[0].status === "rejected" ? ["nmc_location"] : []),
    ...(settled[1].status === "rejected" ? ["hira"] : []),
    ...(realtime.metadata.degraded ? ["nmc_realtime"] : []),
  ];
  return {
    hospitals: sortHospitalReferences(hospitals),
    reference_at: new Date().toISOString(),
    source: hospitals.length ? "live_reference_apis" : "unavailable",
    degraded_sources: degradedSources,
    nmc_realtime_status: realtime.metadata,
    notice: `카카오 경로 성공 항목은 도로 ETA 순입니다. 실패 항목은 직선거리만 표시하며 ETA를 제공하지 않습니다. ${realtime.metadata.notice} 최종 수용 여부는 병원의 YES 응답으로만 확인해야 합니다.`,
  };
}
