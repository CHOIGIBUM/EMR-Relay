import type { Coordinate } from "./types";

export type NamedCoordinate = Coordinate & { name: string };

export function buildKakaoDirectionsLink(origin: NamedCoordinate, destination: NamedCoordinate): string {
  const point = ({ name, latitude, longitude }: NamedCoordinate) => `${encodeURIComponent(name)},${latitude},${longitude}`;
  return `https://map.kakao.com/link/by/car/${point(origin)}/${point(destination)}`;
}
