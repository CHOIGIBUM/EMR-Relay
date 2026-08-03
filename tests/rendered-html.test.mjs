import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CARDIO_DEMO_PTT_UPDATES } from "../lib/cardioDemoData.ts";
import {
  createLocalVoiceProposal,
  getLocalHealth,
  getLocalHospitalDirectory,
} from "../lib/localDemoApi.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readStaticPage(route = "/") {
  const segments = route.split("?")[0].split("/").filter(Boolean);
  return readFileSync(path.join(projectRoot, "out", ...segments, "index.html"), "utf8");
}

test("exports the role login shell for AWS Amplify static hosting", () => {
  const html = readStaticPage();
  assert.match(html, /<title>EMS Relay \| 심혈관 응급환자 실시간 인계<\/title>/i);
  assert.match(html, /EMS Relay/);
  assert.match(html, /업무 계정으로 로그인/);
  assert.match(html, /소속과 역할/);
  assert.match(html, /og:image/);
  assert.match(html, /main\.d2edch3bt6kxej\.amplifyapp\.com\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("exports the complete demo workflow as a static route", () => {
  const html = readStaticPage("/demo/workflow");
  assert.match(html, /EMS Relay/);
  assert.match(html, /구급대원/);
  assert.match(html, /EMS-GW-050/);
  assert.match(html, /출동 사건 1건/);
});

test("operational static shells do not embed synthetic patient facts", () => {
  for (const route of ["/paramedic", "/control", "/hospital", "/reports"]) {
    const html = readStaticPage(route);
    assert.doesNotMatch(html, /73세 여성|흉통·의식은 유지|아스피린|한림대학교춘천성심병원|강릉아산병원|원주세브란스기독병원/);
  }
});

test("keeps local health and hospital fixtures in the browser bundle contract", () => {
  const health = getLocalHealth();
  assert.equal(health.mode, "local-mock");
  assert.equal(health.services.agent.status, "available");
  assert.match(health.services.persistence.provider, /local-storage/);

  const directory = getLocalHospitalDirectory();
  assert.equal(directory.source, "local_fixture");
  assert.equal(directory.hospitals.length, 3);
  assert.ok(directory.hospitals.some((hospital) => hospital.hospital_id === "H-GW-EMG-016"));
});

test("structures the prepared field statement without a local HTTP route", async () => {
  const reference = CARDIO_DEMO_PTT_UPDATES[0];
  const result = await createLocalVoiceProposal({
    case_id: "GW-CARDIO-050",
    update_id: reference.id,
    transcript: reference.transcript,
  });
  assert.equal(result.pending_review, true);
  assert.equal(result.update_id, "GW-CARDIO-050-U01");
  assert.equal(result.proposed_updates.length, 3);
  assert.ok(result.proposed_updates.every((proposal) => proposal.review_state === "pending_review"));
  assert.ok(result.proposed_updates.every((proposal) => proposal.fact_status !== "confirmed"));
});
