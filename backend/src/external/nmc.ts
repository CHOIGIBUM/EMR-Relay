import { XMLParser } from "fast-xml-parser";
import { asArray, fetchWithTimeout } from "./http.js";
import type { ExternalApiSecrets } from "./secretProvider.js";

export type ReferenceFacility = {
  id: string;
  name: string;
  address?: string;
  regionLabel?: string;
  careLevel?: string;
  latitude?: number;
  longitude?: number;
  capabilities: string[];
  sources: ("NMC" | "HIRA")[];
};

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchNmcFacilities(secrets: ExternalApiSecrets, latitude: number, longitude: number) {
  if (!secrets.NMC_SERVICE_KEY) return [];
  const url = new URL(secrets.NMC_BASE_URL ?? "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytLcinfoInqire");
  url.searchParams.set("serviceKey", secrets.NMC_SERVICE_KEY.includes("%") ? decodeURIComponent(secrets.NMC_SERVICE_KEY) : secrets.NMC_SERVICE_KEY);
  url.searchParams.set("WGS84_LAT", String(latitude));
  url.searchParams.set("WGS84_LON", String(longitude));
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "50");
  const xml = await (await fetchWithTimeout(url)).text();
  const parsed = parser.parse(xml) as { response?: { body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } } } };
  return asArray(parsed.response?.body?.items?.item).flatMap((item): ReferenceFacility[] => {
    const id = String(item.hpid ?? "").trim();
    const name = String(item.dutyName ?? "").trim();
    if (!id || !name) return [];
    const lat = number(item.wgs84Lat);
    const lng = number(item.wgs84Lon);
    return [{
      id,
      name,
      capabilities: ["NMC 응급의료기관 참고정보", "수용 여부 정보 아님"],
      sources: ["NMC"],
      ...(typeof item.dutyAddr === "string" ? { address: item.dutyAddr } : {}),
      ...(typeof item.dutyEmclsName === "string" ? { careLevel: item.dutyEmclsName } : {}),
      ...(lat !== undefined ? { latitude: lat } : {}),
      ...(lng !== undefined ? { longitude: lng } : {}),
    }];
  });
}
