import assert from "node:assert/strict";
import test from "node:test";

async function fetchApplication(request) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return fetchApplication(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
  );
}

test("renders the EMS Relay application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>EMS Relay \| 급성 뇌졸중 의심 환자 정보 연결<\/title>/i);
  assert.match(html, /EMS Relay/);
  assert.match(html, /구급대/);
  assert.match(html, /병원/);
  assert.match(html, /상황실/);
  assert.match(html, /EMS-GW-001/);
  assert.match(html, /70대 추정 여성/);
  assert.match(html, /홍천군 북방면/);
  assert.match(html, /출동 사건 1건/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /EMS-GW-002|EMS-GW-003|60대 추정 남성/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("serves the local MVP health and hospital fixtures", async () => {
  const healthResponse = await fetchApplication(
    new Request("http://localhost/api/local/health", { headers: { accept: "application/json" } }),
  );
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.mode, "local-mock");
  assert.equal(health.services.agent.status, "available");
  assert.match(health.services.persistence.provider, /local-storage/);

  const hospitalResponse = await fetchApplication(
    new Request("http://localhost/api/local/hospitals", { headers: { accept: "application/json" } }),
  );
  assert.equal(hospitalResponse.status, 200);
  const directory = await hospitalResponse.json();
  assert.equal(directory.dataSource, "local-demo-fixture");
  assert.equal(directory.hospitals.length, 3);
  assert.ok(directory.hospitals.some((hospital) => hospital.id === "hallym"));
});

test("structures the example field statement through the local agent API", async () => {
  const response = await fetchApplication(
    new Request("http://localhost/api/local/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: "78세 여성, 의식 명료. 오른쪽 얼굴과 팔에 위약이 있고 말이 어눌합니다. LNT 13시 40분, FAT 14시 15분입니다.",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, "local-deterministic-agent");
  assert.deepEqual(result.structured, {
    avpu: "A",
    face: "우측",
    arm: "우측",
    speech: "어눌함",
    lnt: "13:40",
    fat: "14:15",
  });
  assert.ok(result.processingDelayMs >= 300 && result.processingDelayMs <= 600);
});
