import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
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
