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
  nmcRealtimeResources?: NmcRealtimeResources;
};

export type NmcCapacityValue = {
  /** Original NMC code/value. Kept because negative and other coded values
   * must not be interpreted as a usable capacity. */
  raw: string | null;
  count: number | null;
};

export type NmcAvailabilityValue = {
  /** Original NMC code. Values other than the documented Y/N remain unknown. */
  raw: string | null;
  status: "available" | "unavailable" | "unknown";
};

export type NmcRealtimeResources = {
  reported_at: string | null;
  emergency_room: NmcCapacityValue;
  operating_room: NmcCapacityValue;
  intensive_care: {
    neurological: NmcCapacityValue;
    neonatal: NmcCapacityValue;
    thoracic: NmcCapacityValue;
    general: NmcCapacityValue;
  };
  ct: NmcAvailabilityValue;
  mri: NmcAvailabilityValue;
  angiography: NmcAvailabilityValue;
  ventilator: NmcAvailabilityValue;
};

export type NmcRegion = { stage1: string; stage2: string };

export type NmcRealtimeEnrichmentStatus = {
  status: "live" | "partial" | "unavailable" | "not_requested";
  degraded: boolean;
  requested_regions: number;
  successful_regions: number;
  matched_hospitals: number;
  notice: string;
};

export type NmcRealtimeEnrichmentResult = {
  facilities: ReferenceFacility[];
  metadata: NmcRealtimeEnrichmentStatus;
};

type NmcRealtimeFeedEntry = {
  name: string | null;
  resources: NmcRealtimeResources;
};

type NmcRealtimeRegionalEntry = NmcRealtimeFeedEntry & { region: NmcRegion };

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
const DEFAULT_NMC_LOCATION_URL = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytLcinfoInqire";
const DEFAULT_NMC_REALTIME_URL = "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire";
export const MAX_NMC_REALTIME_REGION_REQUESTS = 4;
const VERIFIED_NMC_HIRA_INSTITUTION_IDS: Readonly<Record<string, readonly string[]>> = {
  // NMC: 의료법인온세움의료재단온재병원 / HIRA: 온재병원.
  // Verified against both production feeds on 2026-08-04.
  A2200046: ["JDQ4MTYyMiM1MSMkMSMkNCMkODkkMzgxMzUxIzExIyQxIyQzIyQ5OSQyNjE4MzIjNDEjJDEjJDQjJDgz"],
};

const stage1Names = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

const legacyStage1Names: Record<string, string> = {
  강원도: "강원특별자치도",
  전라북도: "전북특별자치도",
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizedText(value: unknown) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function facilityNameKey(value: string) {
  return value.replace(/[\s()[\]{}·.,-]+/g, "").toLowerCase();
}

function regionKey(region: NmcRegion) {
  return `${region.stage1}\u0000${region.stage2}`;
}

function sameFacilityName(left: string, right: string) {
  return facilityNameKey(left) === facilityNameKey(right);
}

function isVerifiedNmcHiraMatch(hpid: string, nmcName: string, facility: ReferenceFacility) {
  return sameFacilityName(nmcName, facility.name)
    || Boolean(VERIFIED_NMC_HIRA_INSTITUTION_IDS[hpid]?.includes(facility.id));
}

function capacityValue(value: unknown): NmcCapacityValue {
  const raw = normalizedText(value);
  if (raw === null) return { raw: null, count: null };
  const parsed = Number(raw);
  return {
    raw,
    count: Number.isInteger(parsed) && parsed >= 0 ? parsed : null,
  };
}

function availabilityValue(value: unknown): NmcAvailabilityValue {
  const raw = normalizedText(value);
  const normalized = raw?.toUpperCase();
  return {
    raw,
    status: normalized === "Y" ? "available" : normalized === "N" ? "unavailable" : "unknown",
  };
}

function serviceKey(secrets: ExternalApiSecrets) {
  const key = secrets.NMC_SERVICE_KEY;
  return key?.includes("%") ? decodeURIComponent(key) : key;
}

function realtimeEndpoint(secrets: ExternalApiSecrets) {
  if (secrets.NMC_REALTIME_BASE_URL) return new URL(secrets.NMC_REALTIME_BASE_URL);
  if (!secrets.NMC_BASE_URL) return new URL(DEFAULT_NMC_REALTIME_URL);
  const configured = new URL(secrets.NMC_BASE_URL);
  if (configured.pathname.endsWith("/getEgytLcinfoInqire")) {
    configured.pathname = configured.pathname.replace(/\/getEgytLcinfoInqire$/, "/getEmrrmRltmUsefulSckbdInfoInqire");
    configured.search = "";
    return configured;
  }
  if (configured.pathname.endsWith("/ErmctInfoInqireService")) {
    configured.pathname += "/getEmrrmRltmUsefulSckbdInfoInqire";
    configured.search = "";
    return configured;
  }
  return new URL(DEFAULT_NMC_REALTIME_URL);
}

/** Derives the public API's STAGE1/STAGE2 parameters from an NMC address.
 * Compound city/district values such as "청주시 흥덕구" are preserved. */
export function nmcRegionFromAddress(address?: string): NmcRegion | null {
  if (!address) return null;
  const tokens = address.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
  const stage1Index = tokens.findIndex((token) => stage1Names.includes(token as typeof stage1Names[number]) || token in legacyStage1Names);
  if (stage1Index < 0) return null;
  const rawStage1 = tokens[stage1Index];
  if (!rawStage1) return null;
  const stage1 = legacyStage1Names[rawStage1] ?? rawStage1;
  const locality = tokens.slice(stage1Index + 1).filter((token) => /(?:시|군|구)$/.test(token));
  if (!locality.length) {
    return stage1 === "세종특별자치시" ? { stage1, stage2: stage1 } : null;
  }
  const first = locality[0];
  if (!first) return null;
  const second = locality[1];
  const stage2 = first.endsWith("시") && second?.endsWith("구") ? `${first} ${second}` : first;
  return { stage1, stage2 };
}

type NmcXmlResponse = {
  response?: {
    header?: { resultCode?: unknown; resultMsg?: unknown; resultMag?: unknown };
    body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } };
  };
};

/** Parses only the public institution identity and non-personal operational
 * resource fields. Duty doctor names, direct phone numbers and other contact
 * details are deliberately ignored. */
function parseNmcRealtimeFeed(xml: string) {
  const parsed = parser.parse(xml) as NmcXmlResponse;
  const resultCode = normalizedText(parsed.response?.header?.resultCode);
  if (resultCode && !/^0+$/.test(resultCode)) throw new Error(`NMC_REALTIME_${resultCode}`);
  const feed = new Map<string, NmcRealtimeFeedEntry>();
  for (const item of asArray(parsed.response?.body?.items?.item)) {
    const hpid = normalizedText(item.hpid);
    if (!hpid) continue;
    feed.set(hpid, {
      name: normalizedText(item.dutyName ?? item.dutyname),
      resources: {
        reported_at: normalizedText(item.hvidate),
        emergency_room: capacityValue(item.hvec),
        operating_room: capacityValue(item.hvoc),
        intensive_care: {
          neurological: capacityValue(item.hvcc),
          neonatal: capacityValue(item.hvncc),
          thoracic: capacityValue(item.hvccc),
          general: capacityValue(item.hvicc),
        },
        ct: availabilityValue(item.hvctayn),
        mri: availabilityValue(item.hvmriayn),
        angiography: availabilityValue(item.hvangioayn),
        ventilator: availabilityValue(item.hvventiayn),
      },
    });
  }
  return feed;
}

export function parseNmcRealtimeResources(xml: string) {
  return new Map([...parseNmcRealtimeFeed(xml)].map(([hpid, entry]) => [hpid, entry.resources]));
}

async function fetchNmcRealtimeFeed(secrets: ExternalApiSecrets, region: NmcRegion) {
  const key = serviceKey(secrets);
  if (!key) return new Map<string, NmcRealtimeFeedEntry>();
  const url = realtimeEndpoint(secrets);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("STAGE1", region.stage1);
  url.searchParams.set("STAGE2", region.stage2);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "100");
  const xml = await (await fetchWithTimeout(url)).text();
  return parseNmcRealtimeFeed(xml);
}

export async function fetchNmcRealtimeResources(secrets: ExternalApiSecrets, region: NmcRegion) {
  const feed = await fetchNmcRealtimeFeed(secrets, region);
  return new Map([...feed].map(([hpid, entry]) => [hpid, entry.resources]));
}

/** Calls a bounded, de-duplicated set of regional feeds and joins by HPID.
 * Failure of any/all realtime feeds never removes the original candidates. */
export async function enrichFacilitiesWithNmcRealtime(
  secrets: ExternalApiSecrets,
  facilities: ReferenceFacility[],
  maxRegionRequests = MAX_NMC_REALTIME_REGION_REQUESTS,
  discoveryFacilities: ReferenceFacility[] = [],
): Promise<NmcRealtimeEnrichmentResult> {
  const boundedLimit = Math.max(0, Math.min(MAX_NMC_REALTIME_REGION_REQUESTS, Math.floor(maxRegionRequests)));
  const regionsByKey = new Map<string, NmcRegion>();
  if (boundedLimit > 0) {
    for (const facility of [...facilities, ...discoveryFacilities]) {
      const region = nmcRegionFromAddress(facility.address);
      if (!region) continue;
      const key = regionKey(region);
      if (!regionsByKey.has(key)) regionsByKey.set(key, region);
      if (regionsByKey.size >= boundedLimit) break;
    }
  }
  const regions = [...regionsByKey.values()];
  if (!secrets.NMC_SERVICE_KEY || !regions.length) {
    return {
      facilities,
      metadata: {
        status: "not_requested",
        degraded: false,
        requested_regions: 0,
        successful_regions: 0,
        matched_hospitals: 0,
        notice: !secrets.NMC_SERVICE_KEY
          ? "NMC 실시간 자원 API 키가 없어 자원 정보는 조회하지 않았습니다."
          : "후보 병원 주소에서 NMC 조회 지역을 확인할 수 없어 자원 정보는 조회하지 않았습니다.",
      },
    };
  }

  const settled = await Promise.allSettled(regions.map((region) => fetchNmcRealtimeFeed(secrets, region)));
  const mergedFeed = new Map<string, NmcRealtimeRegionalEntry>();
  let successfulRegions = 0;
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    successfulRegions += 1;
    const region = regions[index];
    if (!region) return;
    for (const [hpid, entry] of result.value) mergedFeed.set(hpid, { ...entry, region });
  });
  let matchedHospitals = 0;
  const enriched = facilities.map((facility) => {
    const entry = mergedFeed.get(facility.id);
    if (!entry) return facility;
    matchedHospitals += 1;
    return { ...facility, nmcRealtimeResources: entry.resources };
  });
  const existingIds = new Set(enriched.map((facility) => facility.id));
  const usedDiscoveryIds = new Set<string>();
  for (const [hpid, entry] of mergedFeed) {
    if (existingIds.has(hpid) || !entry.name) continue;
    if (enriched.some((facility) => sameFacilityName(facility.name, entry.name as string))) continue;
    const matches = discoveryFacilities.filter((facility) => {
      if (facility.latitude === undefined || facility.longitude === undefined || usedDiscoveryIds.has(facility.id)) return false;
      const facilityRegion = nmcRegionFromAddress(facility.address);
      return facilityRegion !== null
        && regionKey(facilityRegion) === regionKey(entry.region)
        && isVerifiedNmcHiraMatch(hpid, entry.name as string, facility);
    });
    // Ambiguous name matches are deliberately excluded. NMC HPID remains the
    // authority; HIRA supplies only the unique matching institution's route data.
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (!match) continue;
    usedDiscoveryIds.add(match.id);
    existingIds.add(hpid);
    matchedHospitals += 1;
    enriched.push({
      id: hpid,
      name: entry.name,
      ...(match.address ? { address: match.address } : {}),
      ...(match.regionLabel ? { regionLabel: match.regionLabel } : {}),
      ...(match.careLevel ? { careLevel: match.careLevel } : {}),
      latitude: match.latitude as number,
      longitude: match.longitude as number,
      capabilities: [...new Set([
        "NMC 응급의료기관 참고정보",
        "병원 수용 확정 정보 아님",
        ...match.capabilities,
      ])],
      sources: [...new Set<"NMC" | "HIRA">(["NMC", ...match.sources])],
      nmcRealtimeResources: entry.resources,
    });
  }
  const failedRegions = regions.length - successfulRegions;
  const status = failedRegions === 0
    ? (matchedHospitals > 0 ? "live" : "unavailable")
    : (successfulRegions > 0 ? "partial" : "unavailable");
  const degraded = status === "partial" || status === "unavailable";
  const notice = status === "live"
    ? "NMC 실시간 자원 현황을 조회했습니다. 자원 수치는 참고정보이며 병원의 수용 확정 응답이 아닙니다."
    : status === "partial"
      ? "일부 지역의 NMC 실시간 자원 조회에 실패했습니다. 조회된 값도 병원의 수용 확정 응답이 아닙니다."
      : successfulRegions > 0
        ? "NMC 실시간 자원 조회는 성공했지만 후보 병원과 일치하는 HPID 자료가 없습니다. 병원 수용 여부를 별도로 확인해야 합니다."
        : "NMC 실시간 자원 조회에 실패했습니다. 기존 병원 후보와 경로 정보만 제공하며 병원 수용 여부를 별도로 확인해야 합니다.";
  return {
    facilities: enriched,
    metadata: {
      status,
      degraded,
      requested_regions: regions.length,
      successful_regions: successfulRegions,
      matched_hospitals: matchedHospitals,
      notice,
    },
  };
}

export async function fetchNmcFacilities(secrets: ExternalApiSecrets, latitude: number, longitude: number) {
  if (!secrets.NMC_SERVICE_KEY) return [];
  const url = new URL(secrets.NMC_BASE_URL ?? DEFAULT_NMC_LOCATION_URL);
  url.searchParams.set("serviceKey", serviceKey(secrets) as string);
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
    // The current location API returns `latitude`/`longitude`. Keep the older
    // WGS84 field aliases as fallbacks because public-data response versions
    // have used both shapes.
    const lat = number(item.latitude ?? item.wgs84Lat ?? item.WGS84_LAT);
    const lng = number(item.longitude ?? item.wgs84Lon ?? item.WGS84_LON);
    return [{
      id,
      name,
      capabilities: ["NMC 응급의료기관 참고정보", "병원 수용 확정 정보 아님"],
      sources: ["NMC"],
      ...(typeof item.dutyAddr === "string" ? { address: item.dutyAddr } : {}),
      ...(typeof (item.dutyEmclsName ?? item.dutyDivName) === "string"
        ? { careLevel: String(item.dutyEmclsName ?? item.dutyDivName) }
        : {}),
      ...(lat !== undefined ? { latitude: lat } : {}),
      ...(lng !== undefined ? { longitude: lng } : {}),
    }];
  });
}
