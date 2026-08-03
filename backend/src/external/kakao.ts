import { fetchWithTimeout } from "./http.js";
import type { ExternalApiSecrets } from "./secretProvider.js";

type KakaoDirections = {
  routes?: Array<{ result_code?: number; summary?: { distance?: number; duration?: number } }>;
};

export async function fetchKakaoRoute(
  secrets: ExternalApiSecrets,
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  if (!secrets.KAKAO_REST_API_KEY) return null;
  const url = new URL(secrets.KAKAO_DIRECTIONS_URL ?? "https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${origin.longitude},${origin.latitude}`);
  url.searchParams.set("destination", `${destination.longitude},${destination.latitude}`);
  url.searchParams.set("priority", "RECOMMEND");
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${secrets.KAKAO_REST_API_KEY}` },
  });
  const data = await response.json() as KakaoDirections;
  const summary = data.routes?.find((route) => route.result_code === 0)?.summary;
  if (!summary || typeof summary.distance !== "number" || typeof summary.duration !== "number") return null;
  return { distanceKm: summary.distance / 1_000, etaMinutes: Math.max(1, Math.ceil(summary.duration / 60)) };
}

