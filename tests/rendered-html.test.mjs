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
  assert.match(html, /<title>EMS Relay \| 심혈관 응급환자 실시간 인계<\/title>/i);
  assert.match(html, /EMS Relay/);
  assert.match(html, /구급대/);
  assert.match(html, /병원/);
  assert.match(html, /상황실/);
  assert.match(html, /EMS-GW-050/);
  assert.match(html, /65~74세 추정 여성/);
  assert.match(html, /속초시/);
  assert.match(html, /출동 사건 1건/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /EMS-GW-001|EMS-GW-002|EMS-GW-003|60대 추정 남성/);
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
  assert.equal(directory.source, "local_fixture");
  assert.equal(directory.hospitals.length, 3);
  assert.ok(directory.hospitals.some((hospital) => hospital.hospital_id === "H-GW-EMG-016"));
});

test("structures the example field statement through the local agent API", async () => {
  const response = await fetchApplication(
    new Request("http://localhost/api/local/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        case_id: "GW-CARDIO-050",
        updateId: "GW-CARDIO-050-U01",
        transcript: "73세 여성 환자입니다. 주호소는 쥐어짜는 양상의 흉통입니다. 현재 의식은 AVPU A이고 목격자 진술과 함께 확인했습니다.",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pending_review, true);
  assert.equal(result.update_id, "GW-CARDIO-050-U01");
  assert.equal(result.proposed_updates.length, 3);
  assert.ok(result.proposed_updates.every((proposal) => proposal.review_state === "pending_review"));
  assert.ok(result.proposed_updates.every((proposal) => proposal.fact_status !== "confirmed"));
});
