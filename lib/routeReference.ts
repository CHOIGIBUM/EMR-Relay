export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type NamedLocation = Coordinate & {
  name: string;
  address: string;
};

export type RouteReferenceSource =
  | "kakao_mobility_live"
  | "kakao_mobility_snapshot"
  | "local_straight_line_estimate"
  | "unavailable";

export type RouteReference = {
  origin: NamedLocation;
  destination: NamedLocation;
  distanceKm: number | null;
  etaMinutes: number | null;
  source: RouteReferenceSource;
  calculatedAt: string;
  isLive: boolean;
  isRoadRoute: boolean;
  notice: string;
};

export function isCoordinate(value: Coordinate): boolean {
  return Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

export function haversineDistanceKm(origin: Coordinate, destination: Coordinate): number {
  if (!isCoordinate(origin) || !isCoordinate(destination)) throw new Error("INVALID_COORDINATE");
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(origin.latitude))
    * Math.cos(radians(destination.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Offline fallback for layout/testing only. It deliberately has no ETA because
 * a straight-line distance is not a road route and must not be shown as one.
 */
export function createStraightLineFallback(
  origin: NamedLocation,
  destination: NamedLocation,
  calculatedAt = new Date().toISOString(),
): RouteReference {
  return {
    origin,
    destination,
    distanceKm: Number(haversineDistanceKm(origin, destination).toFixed(1)),
    etaMinutes: null,
    source: "local_straight_line_estimate",
    calculatedAt,
    isLive: false,
    isRoadRoute: false,
    notice: "직선거리 기반 로컬 추정값이며 실제 도로 경로·교통시간이 아닙니다.",
  };
}

export function buildKakaoDirectionsLink(destination: Coordinate & { name: string }): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(destination.name)},${destination.latitude},${destination.longitude}`;
}
