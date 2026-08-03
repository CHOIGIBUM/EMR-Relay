import { XMLParser } from "fast-xml-parser";
import { asArray, fetchWithTimeout } from "./http.js";
import type { ReferenceFacility } from "./nmc.js";
import type { ExternalApiSecrets } from "./secretProvider.js";

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchHiraFacilities(secrets: ExternalApiSecrets, latitude: number, longitude: number) {
  if (!secrets.HIRA_SERVICE_KEY) return [];
  const url = new URL(secrets.HIRA_BASE_URL ?? "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList");
  url.searchParams.set("ServiceKey", secrets.HIRA_SERVICE_KEY.includes("%") ? decodeURIComponent(secrets.HIRA_SERVICE_KEY) : secrets.HIRA_SERVICE_KEY);
  url.searchParams.set("xPos", String(longitude));
  url.searchParams.set("yPos", String(latitude));
  url.searchParams.set("radius", "100000");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "100");
  const xml = await (await fetchWithTimeout(url)).text();
  const parsed = parser.parse(xml) as { response?: { body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } } } };
  return asArray(parsed.response?.body?.items?.item).flatMap((item): ReferenceFacility[] => {
    const id = String(item.ykiho ?? item.yadmNm ?? "").trim();
    const name = String(item.yadmNm ?? "").trim();
    if (!id || !name) return [];
    const lat = number(item.YPos ?? item.yPos);
    const lng = number(item.XPos ?? item.xPos);
    return [{
      id,
      name,
      capabilities: ["HIRA 의료기관 기본정보", "수용 여부 정보 아님"],
      sources: ["HIRA"],
      ...(typeof item.addr === "string" ? { address: item.addr } : {}),
      ...(typeof item.clCdNm === "string" ? { careLevel: item.clCdNm } : {}),
      ...(lat !== undefined ? { latitude: lat } : {}),
      ...(lng !== undefined ? { longitude: lng } : {}),
    }];
  });
}
