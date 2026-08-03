import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAgentModelOutput,
  validateAgentRequest,
  validateConfirmRequest,
} from "../src/schemas.js";

test("validates a PTT agent request", () => {
  const result = validateAgentRequest({
    caseId: "GW-CARDIO-050",
    transcript: "혈압 163에 90, 맥박 91회, 식은땀과 오심 있습니다.",
    observedAt: "2026-08-03T14:28:00+09:00",
    source: "ptt",
    requestedBy: "PARAMEDIC-01",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.transcript.includes("163"), true);
});

test("rejects unbounded transcript and malformed case id", () => {
  const result = validateAgentRequest({
    caseId: "?",
    transcript: "",
    source: "audio",
    requestedBy: "",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.length >= 4);
});

test("validates strict-ish Bedrock proposal output", () => {
  const result = validateAgentModelOutput({
    schemaVersion: "1.0",
    summary: "최초 활력징후와 동반증상을 변경안으로 정리했습니다.",
    changes: [
      {
        path: "vitals.systolicBp",
        value: 163,
        unit: "mmHg",
        observedAt: "2026-08-03T14:28:00+09:00",
        certainty: "clear",
        sourceText: "혈압 163에 90",
      },
      {
        path: "history.medications",
        value: null,
        certainty: "unknown",
        sourceText: "복용약은 확인이 안 됩니다",
      },
    ],
    flags: [{
      code: "MEDICATION_UNKNOWN",
      severity: "warning",
      field: "history.medications",
      message: "복용약 확인이 필요합니다.",
    }],
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.changes.length, 2);
});

test("rejects a model-proposed path outside the allowlist", () => {
  const result = validateAgentModelOutput({
    schemaVersion: "1.0",
    summary: "병원을 선택했습니다.",
    changes: [{
      path: "hospital.recommended",
      value: "A병원",
      certainty: "clear",
      sourceText: "A병원으로 가자",
    }],
    flags: [],
  });

  assert.equal(result.ok, false);
});

test("requires unique HITL decisions", () => {
  const result = validateConfirmRequest({
    proposalId: "proposal-001",
    expectedVersion: 2,
    reviewedBy: "PARAMEDIC-01",
    decisions: [
      { changeId: "change-001", action: "accept" },
      { changeId: "change-001", action: "reject" },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.includes("중복")));
});
