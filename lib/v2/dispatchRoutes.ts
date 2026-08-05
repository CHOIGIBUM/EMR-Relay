import type { Coordinate } from "./types";

export type DispatchRouteReference = {
  stationName: string;
  stationAddress: string;
  origin: Coordinate;
  distanceKm: number;
  etaMinutes: number;
};

// Public station locations and Kakao road-route references for the three MVP cases.
export const DISPATCH_ROUTES: Readonly<Record<string, DispatchRouteReference>> = {
  "GW-STROKE-001": {
    stationName: "영랑119안전센터",
    stationAddress: "강원특별자치도 속초시 번영로 188",
    origin: { latitude: 38.2154164233856, longitude: 128.59031570815 },
    distanceKm: 1.5,
    etaMinutes: 6,
  },
  "GW-STROKE-002": {
    stationName: "옥천119안전센터",
    stationAddress: "강원특별자치도 강릉시 용지로 139",
    origin: { latitude: 37.7610565940874, longitude: 128.902116895545 },
    distanceKm: 1.2,
    etaMinutes: 5,
  },
  "GW-STROKE-003": {
    stationName: "천곡119안전센터",
    stationAddress: "강원특별자치도 동해시 천곡로 120",
    origin: { latitude: 37.5245120362346, longitude: 129.118857793081 },
    distanceKm: 0.5,
    etaMinutes: 2,
  },
};

export function getDispatchRoute(caseId: string) {
  return DISPATCH_ROUTES[caseId] ?? null;
}
