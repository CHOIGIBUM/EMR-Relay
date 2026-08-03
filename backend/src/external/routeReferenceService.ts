import { fetchKakaoRoute } from "./kakao.js";
import { getExternalApiSecrets } from "./secretProvider.js";

export type RouteCoordinate = { latitude: number; longitude: number };

export type RouteReferenceRequest = {
  caseId: string;
  origin: RouteCoordinate;
  destination: RouteCoordinate;
};

type RouteReferenceRequestValidation =
  | { ok: true; value: RouteReferenceRequest }
  | { ok: false; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coordinateFrom(value: unknown): RouteCoordinate | null {
  if (!isRecord(value)) return null;
  const latitude = value.latitude;
  const longitude = value.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  const coordinate = { latitude, longitude };
  return validRouteCoordinate(coordinate) ? coordinate : null;
}

export function validRouteCoordinate(value: RouteCoordinate) {
  return Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

/**
 * Validates the authenticated POST /route payload. Coordinates are carried in
 * the JSON body so precise locations are not copied into access-log query
 * strings. The handler separately validates and authorizes the bound caseId
 * before any external API call is made.
 */
export function validateRouteReferenceRequest(body: unknown): RouteReferenceRequestValidation {
  if (!isRecord(body)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };
  const caseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
  const origin = coordinateFrom(body.origin);
  const destination = coordinateFrom(body.destination);
  const issues: string[] = [];
  if (!caseId) issues.push("case_id가 필요합니다.");
  if (!origin) issues.push("origin에는 유효한 latitude와 longitude가 필요합니다.");
  if (!destination) issues.push("destination에는 유효한 latitude와 longitude가 필요합니다.");
  if (issues.length || !origin || !destination) return { ok: false, issues };
  return { ok: true, value: { caseId, origin, destination } };
}

export async function getLiveRouteReference(origin: RouteCoordinate, destination: RouteCoordinate) {
  if (!validRouteCoordinate(origin) || !validRouteCoordinate(destination)) throw new Error("INVALID_ROUTE_COORDINATE");
  const calculatedAt = new Date().toISOString();
  const secrets = await getExternalApiSecrets();
  const route = await fetchKakaoRoute(secrets, origin, destination, { includePath: true }).catch(() => null);
  if (!route) {
    return {
      distance_km: null,
      eta_minutes: null,
      source: "unavailable" as const,
      is_live: false,
      is_road_route: false,
      calculated_at: calculatedAt,
      notice: "카카오 자동차 경로를 현재 조회할 수 없습니다. 직선거리나 임의 시간을 대신 표시하지 않습니다.",
    };
  }
  return {
    distance_km: Number(route.distanceKm.toFixed(1)),
    eta_minutes: route.etaMinutes,
    source: "kakao_mobility_live" as const,
    is_live: true,
    is_road_route: true,
    calculated_at: calculatedAt,
    notice: "카카오 자동차 추천경로 기준이며 실제 교통상황에 따라 달라질 수 있습니다.",
    path: route.path,
  };
}
