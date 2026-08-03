import { fetchWithTimeout } from "./http.js";
import type { ExternalApiSecrets } from "./secretProvider.js";

type KakaoDirections = {
  routes?: Array<{
    result_code?: number;
    summary?: { distance?: number; duration?: number };
    sections?: Array<{ roads?: Array<{ vertexes?: number[] }> }>;
  }>;
};

function sampleRoutePath(path: Array<{ latitude: number; longitude: number }>, limit = 400) {
  if (path.length <= limit) return path;
  const step = Math.ceil(path.length / (limit - 1));
  const sampled = path.filter((_, index) => index % step === 0);
  const last = path.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

export function parseKakaoDirections(data: KakaoDirections) {
  const route = data.routes?.find((candidate) => candidate.result_code === 0);
  const summary = route?.summary;
  if (!summary || typeof summary.distance !== "number" || typeof summary.duration !== "number") return null;
  const path = sampleRoutePath((route.sections ?? []).flatMap((section) => (section.roads ?? []).flatMap((road) => {
    const values = Array.isArray(road.vertexes) ? road.vertexes : [];
    const points: Array<{ latitude: number; longitude: number }> = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      const longitude = values[index];
      const latitude = values[index + 1];
      if (typeof latitude === "number" && typeof longitude === "number") points.push({ latitude, longitude });
    }
    return points;
  })));
  return {
    distanceKm: summary.distance / 1_000,
    etaMinutes: Math.max(1, Math.ceil(summary.duration / 60)),
    path,
  };
}

export async function fetchKakaoRoute(
  secrets: ExternalApiSecrets,
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  options: { includePath?: boolean } = {},
) {
  if (!secrets.KAKAO_REST_API_KEY) return null;
  const url = new URL(secrets.KAKAO_DIRECTIONS_URL ?? "https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${origin.longitude},${origin.latitude}`);
  url.searchParams.set("destination", `${destination.longitude},${destination.latitude}`);
  url.searchParams.set("priority", "RECOMMEND");
  if (!options.includePath) url.searchParams.set("summary", "true");
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${secrets.KAKAO_REST_API_KEY}` },
  });
  const data = await response.json() as KakaoDirections;
  return parseKakaoDirections(data);
}
