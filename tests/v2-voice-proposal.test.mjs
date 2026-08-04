import assert from "node:assert/strict";
import test from "node:test";
import { applyVoiceChangesToAssessment } from "../lib/v2/voiceProposal.ts";

const vitalChange = {
  changeId: "vital-1",
  path: "vitals.systolicBp",
  value: 178,
  unit: "mmHg",
  certainty: "stated",
  sourceText: "혈압 178",
  observedAt: "2026-08-04T20:26:00.000Z",
};

test("voice proposal preserves an explicitly entered measurement time", () => {
  const next = applyVoiceChangesToAssessment({ measuredAt: "05:25" }, [vitalChange]);
  assert.equal(next.measuredAt, "05:25");
  assert.equal(next.systolicBp, 178);
});

test("voice-only proposal uses its observed time when no measurement time exists", () => {
  const next = applyVoiceChangesToAssessment({}, [vitalChange]);
  const observed = new Date(vitalChange.observedAt);
  const expected = `${String(observed.getHours()).padStart(2, "0")}:${String(observed.getMinutes()).padStart(2, "0")}`;
  assert.equal(next.measuredAt, expected);
});
