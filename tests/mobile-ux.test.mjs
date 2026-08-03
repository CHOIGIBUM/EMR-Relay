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

test("field workflow exposes required direct inputs without passive instruction cards", () => {
  assert.match(mobile, /aria-label="환자 평가 입력 단계"/);
  assert.match(mobile, /ABC · AVPU · 주호소/);
  assert.match(mobile, /발생시각 · NRS · 동반증상/);
  assert.match(mobile, /BP · PR · RR · SpO₂/);
  assert.match(mobile, /직접 입력 정리/);
  assert.match(mobile, /말로 입력/);
  assert.doesNotMatch(mobile, /<small>다음 업무<\/small>/);
  assert.doesNotMatch(mobile, /현장 안전 확인|정보 제공자|현장 도착과 환자 접촉은 다릅니다/);
});

test("mobile account control is part of the application header", () => {
  assert.match(mobile, /className=\{styles\.headerSignOut\}[\s\S]*onClick=\{auth\.signOut\}/);
  assert.match(mobile, /aria-label="로그아웃"/);
});

test("dispatch and transport use the route API instead of fabricated time and distance", () => {
  assert.match(mobile, /getRouteReference\(\{/);
  assert.match(mobile, /origin=\{SCENARIO\.unitBase\}/);
  assert.match(mobile, /destination=\{SCENARIO\.sceneLocation\}/);
  assert.match(mobile, /path=\{sceneRoute\?\.path\}/);
  assert.match(mobile, /path=\{transportRoute\?\.path\}/);
  assert.doesNotMatch(mobile, /27\.4 km|31분|34분|속초권 도로 기준/);
});

test("saved Kakao demo routes are not presented as live traffic", () => {
  assert.match(mobile, /sceneRouteIsLive \? "카카오 실시간" : "카카오 저장 경로"/);
  assert.match(mobile, /transportRoute\?\.is_live \? "실시간 경로" : operational \? "경로 조회 중" : "저장 경로"/);
  assert.match(mobile, /operational \? "도로거리" : "저장 도로거리"/);
  assert.doesNotMatch(mobile, /카카오 추천경로/);
});

test("hospital candidates distinguish road routes from distance-only fallback", () => {
  assert.match(mobile, /hospital\.isRoadRoute === false \? "직선거리" : operational \? "도로거리" : "저장 도로거리"/);
  assert.match(mobile, /신고 현장 기준/);
});
