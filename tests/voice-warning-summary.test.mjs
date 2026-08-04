import assert from "node:assert/strict";
import test from "node:test";
import { summarizeActionableVoiceWarnings } from "../lib/voiceWarningSummary.ts";

test("voice warning summary hides info and deduplicates fields and messages", () => {
  const summary = summarizeActionableVoiceWarnings([
    { code: "INTERNAL_NOTICE", severity: "info", message: "내부 처리 알림", field_paths: [] },
    { code: "UNIT_MISSING", severity: "warning", message: "단위를 확인하세요.", field_paths: ["vitals.spo2"] },
    { code: "RANGE_REVIEW", severity: "error", message: "측정값을 확인하세요.", field_paths: ["vitals.spo2"] },
    { code: "UNIT_MISSING", severity: "warning", message: "단위를 확인하세요.", field_paths: ["vitals.pulse"] },
    { code: "GENERAL_REVIEW", severity: "warning", message: "전체 입력을 확인하세요.", field_paths: [] },
    { code: "GENERAL_REVIEW", severity: "warning", message: "전체 입력을 확인하세요.", field_paths: [] },
  ]);

  assert.equal(summary.count, 3);
  assert.deepEqual(summary.messages, ["단위를 확인하세요.", "전체 입력을 확인하세요."]);
});

test("evidence-less unknown info notices are not actionable", () => {
  assert.deepEqual(summarizeActionableVoiceWarnings([
    {
      code: "UNSUPPORTED_UNKNOWNS_IGNORED",
      severity: "info",
      message: "원문 근거가 없는 미상 항목을 제외했습니다.",
      field_paths: [],
    },
  ]), { count: 0, messages: [] });
});
