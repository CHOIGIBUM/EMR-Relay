import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobile = readFileSync(new URL("../components/MobileApp.tsx", import.meta.url), "utf8");

test("mobile header is a real case-list home control without a simulated device status bar", () => {
  assert.match(mobile, /className=\{styles\.brandHome\}[\s\S]*onClick=\{returnToCaseList\}/);
  assert.match(mobile, /aria-label="출동 목록으로 이동"/);
  assert.match(mobile, /if\s*\(!caseOpen\)\s*body\s*=\s*renderCaseList\(\)/);
  assert.doesNotMatch(mobile, /●●●|Wi-Fi|▰|styles\.deviceBar/);
});

test("PTT keeps a quick tap listening and safely handles long-press release", () => {
  assert.match(mobile, /type VoiceMode = "listening" \| "stopping" \| "processing" \| "review" \| null/);
  assert.match(mobile, /voiceLongPressTimerRef\.current = window\.setTimeout/);
  assert.match(mobile, /startedWhileListening \|\| wasLongPress/);
  assert.match(mobile, /onClick=\{handleVoiceClick\}/);
  assert.match(mobile, /voiceStopArmTimerRef\.current = window\.setTimeout/);
  assert.match(mobile, /disabled=\{!voiceStopReady\}/);
  assert.match(mobile, /setVoicePhase\("stopping"\)/);
  assert.match(mobile, /voiceMode === "stopping"/);
  assert.doesNotMatch(mobile, /className=\{styles\.voiceOverlay\}[\s\S]{0,180}onPointerUp/);
});
