import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichFacilitiesWithNmcRealtime,
  fetchNmcFacilities,
  fetchNmcRealtimeResources,
  MAX_NMC_REALTIME_REGION_REQUESTS,
  nmcRegionFromAddress,
  parseNmcRealtimeResources,
  type ReferenceFacility,
} from "../src/external/nmc.js";

function nmcLocationXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>00</resultCode></header><body><items><item>
      <hpid>A2200012</hpid>
      <dutyName>강원특별자치도속초의료원</dutyName>
      <dutyAddr>강원특별자치도 속초시 영랑호반길 3 (영랑동)</dutyAddr>
      <dutyDivName>종합병원</dutyDivName>
      <latitude>38.21622784728713</latitude>
      <longitude>128.5891194514502</longitude>
    </item></items></body></response>`;
}

function nmcXml(hpid = "A2200012", options: { angiography?: string; reportedAt?: string; name?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <response>
      <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
      <body><items><item>
        <hpid>${hpid}</hpid>
        <dutyName>${options.name ?? "강원특별자치도속초의료원"}</dutyName>
        <hvidate>${options.reportedAt ?? "20260804124001"}</hvidate>
        <hvec>15</hvec><hvoc>3</hvoc>
        <hvcc>2</hvcc><hvncc>0</hvncc><hvccc>-1</hvccc><hvicc>1</hvicc>
        <hvctayn>Y</hvctayn><hvmriayn>N</hvmriayn>
        <hvangioayn>${options.angiography ?? "N1"}</hvangioayn><hvventiayn>Y</hvventiayn>
        <hvdnm>노출하면 안 되는 당직의</hvdnm><hv1>02-0000-0000</hv1><dutytel3>033-000-0000</dutytel3>
      </item></items></body>
    </response>`;
}

function facility(id: string, address: string): ReferenceFacility {
  return {
    id,
    name: `병원-${id}`,
    address,
    latitude: 38.1,
    longitude: 128.1,
    capabilities: ["NMC 응급의료기관 참고정보"],
    sources: ["NMC"],
  };
}

test("parses only safe NMC realtime resource fields and preserves coded values", () => {
  const resources = parseNmcRealtimeResources(nmcXml());
  const item = resources.get("A2200012");
  assert.ok(item);
  assert.equal(item.reported_at, "20260804124001");
  assert.deepEqual(item.emergency_room, { raw: "15", count: 15 });
  assert.deepEqual(item.operating_room, { raw: "3", count: 3 });
  assert.deepEqual(item.intensive_care.thoracic, { raw: "-1", count: null });
  assert.deepEqual(item.ct, { raw: "Y", status: "available" });
  assert.deepEqual(item.mri, { raw: "N", status: "unavailable" });
  assert.deepEqual(item.angiography, { raw: "N1", status: "unknown" });
  const serialized = JSON.stringify([...resources.entries()]);
  assert.equal(serialized.includes("당직의"), false);
  assert.equal(serialized.includes("02-0000-0000"), false);
  assert.equal(serialized.includes("033-000-0000"), false);
});

test("derives and normalizes NMC STAGE1/STAGE2 address parameters", () => {
  assert.deepEqual(nmcRegionFromAddress("강원특별자치도 속초시 영랑호반길 3"), {
    stage1: "강원특별자치도",
    stage2: "속초시",
  });
  assert.deepEqual(nmcRegionFromAddress("충청북도 청주시 흥덕구 오송읍 1"), {
    stage1: "충청북도",
    stage2: "청주시 흥덕구",
  });
  assert.deepEqual(nmcRegionFromAddress("강원도 춘천시 중앙로 1"), {
    stage1: "강원특별자치도",
    stage2: "춘천시",
  });
  assert.equal(nmcRegionFromAddress("주소 정보 없음"), null);
});

test("calls the official realtime endpoint with regional parameters", async () => {
  const originalFetch = globalThis.fetch;
  let requested: URL | undefined;
  globalThis.fetch = (async (input) => {
    requested = new URL(String(input));
    return new Response(nmcXml(), { status: 200 });
  }) as typeof fetch;
  try {
    const resources = await fetchNmcRealtimeResources(
      { NMC_SERVICE_KEY: "decoded-key" },
      { stage1: "강원특별자치도", stage2: "속초시" },
    );
    assert.equal(resources.has("A2200012"), true);
    assert.ok(requested);
    assert.equal(requested.pathname.endsWith("/getEmrrmRltmUsefulSckbdInfoInqire"), true);
    assert.equal(requested.searchParams.get("STAGE1"), "강원특별자치도");
    assert.equal(requested.searchParams.get("STAGE2"), "속초시");
    assert.equal(requested.searchParams.get("numOfRows"), "100");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses the current NMC location coordinate field names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(nmcLocationXml(), { status: 200 })) as typeof fetch;
  try {
    const facilities = await fetchNmcFacilities({ NMC_SERVICE_KEY: "decoded-key" }, 38.2072, 128.5918);
    assert.deepEqual(facilities, [{
      id: "A2200012",
      name: "강원특별자치도속초의료원",
      address: "강원특별자치도 속초시 영랑호반길 3 (영랑동)",
      careLevel: "종합병원",
      latitude: 38.21622784728713,
      longitude: 128.5891194514502,
      capabilities: ["NMC 응급의료기관 참고정보", "병원 수용 확정 정보 아님"],
      sources: ["NMC"],
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("de-duplicates and bounds regional requests before enriching by HPID", async () => {
  const originalFetch = globalThis.fetch;
  const requestedRegions: string[] = [];
  const idsByStage2: Record<string, string> = {
    속초시: "A1",
    춘천시: "A2",
    강릉시: "A3",
    원주시: "A4",
    태백시: "A5",
  };
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const stage2 = url.searchParams.get("STAGE2") ?? "";
    requestedRegions.push(stage2);
    return new Response(nmcXml(idsByStage2[stage2] ?? "UNKNOWN"), { status: 200 });
  }) as typeof fetch;
  const candidates = [
    facility("A1", "강원특별자치도 속초시 영랑호반길 3"),
    facility("A1-SECOND", "강원특별자치도 속초시 중앙로 1"),
    facility("A2", "강원특별자치도 춘천시 중앙로 1"),
    facility("A3", "강원특별자치도 강릉시 중앙로 1"),
    facility("A4", "강원특별자치도 원주시 중앙로 1"),
    facility("A5", "강원특별자치도 태백시 중앙로 1"),
  ];
  try {
    const result = await enrichFacilitiesWithNmcRealtime({ NMC_SERVICE_KEY: "key" }, candidates);
    assert.equal(requestedRegions.length, MAX_NMC_REALTIME_REGION_REQUESTS);
    assert.deepEqual(requestedRegions, ["속초시", "춘천시", "강릉시", "원주시"]);
    assert.equal(result.metadata.status, "live");
    assert.equal(result.metadata.matched_hospitals, 4);
    assert.ok(result.facilities[0]?.nmcRealtimeResources);
    assert.equal(result.facilities.at(-1)?.nmcRealtimeResources, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps all candidates and reports degraded metadata on partial failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("STAGE2") === "춘천시") throw new Error("upstream unavailable");
    return new Response(nmcXml("A1"), { status: 200 });
  }) as typeof fetch;
  const candidates = [
    facility("A1", "강원특별자치도 속초시 영랑호반길 3"),
    facility("A2", "강원특별자치도 춘천시 중앙로 1"),
  ];
  try {
    const result = await enrichFacilitiesWithNmcRealtime({ NMC_SERVICE_KEY: "key" }, candidates);
    assert.equal(result.facilities.length, 2);
    assert.equal(result.facilities[0]?.id, "A1");
    assert.equal(result.facilities[1]?.id, "A2");
    assert.ok(result.facilities[0]?.nmcRealtimeResources);
    assert.equal(result.facilities[1]?.nmcRealtimeResources, undefined);
    assert.equal(result.metadata.status, "partial");
    assert.equal(result.metadata.degraded, true);
    assert.equal(result.metadata.requested_regions, 2);
    assert.equal(result.metadata.successful_regions, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expands the NMC allowlist only through a verified same-region HIRA identity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(nmcXml("A2200046", {
    name: "의료법인온세움의료재단온재병원",
  }), { status: 200 })) as typeof fetch;
  const existing = [facility("A2200012", "강원특별자치도 속초시 영랑호반길 3")];
  const verifiedHira: ReferenceFacility = {
    id: "JDQ4MTYyMiM1MSMkMSMkNCMkODkkMzgxMzUxIzExIyQxIyQzIyQ5OSQyNjE4MzIjNDEjJDEjJDQjJDgz",
    name: "온재병원",
    address: "강원특별자치도 속초시 중앙로 11",
    careLevel: "종합병원",
    latitude: 38.1980014,
    longitude: 128.5783901,
    capabilities: ["HIRA 의료기관 기본정보"],
    sources: ["HIRA"],
  };
  const ambiguousUnverified: ReferenceFacility = {
    ...verifiedHira,
    id: "unverified-hira-id",
    name: "온재병원",
  };
  try {
    const expanded = await enrichFacilitiesWithNmcRealtime(
      { NMC_SERVICE_KEY: "key" },
      existing,
      1,
      [verifiedHira],
    );
    assert.equal(expanded.facilities.length, 2);
    const discovered = expanded.facilities.find((candidate) => candidate.id === "A2200046");
    assert.ok(discovered);
    assert.equal(discovered.name, "의료법인온세움의료재단온재병원");
    assert.equal(discovered.latitude, verifiedHira.latitude);
    assert.deepEqual(discovered.sources, ["NMC", "HIRA"]);
    assert.ok(discovered.nmcRealtimeResources);

    const blocked = await enrichFacilitiesWithNmcRealtime(
      { NMC_SERVICE_KEY: "key" },
      existing,
      1,
      [ambiguousUnverified],
    );
    assert.equal(blocked.facilities.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
