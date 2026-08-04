import type { Coordinate } from "./types";

export function buildKakaoDirectionsLink(destination: Coordinate & { name: string }): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(destination.name)},${destination.latitude},${destination.longitude}`;
}
