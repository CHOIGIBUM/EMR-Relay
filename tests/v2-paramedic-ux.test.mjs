import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DISPATCH_ROUTES } from "../lib/v2/dispatchRoutes.ts";

const read = (relativePath) => readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

test("keeps verified station-to-scene route references outside the UI component", () => {
  assert.deepEqual(DISPATCH_ROUTES["GW-STROKE-001"], {
    stationName: "영랑119안전센터",
    stationAddress: "강원특별자치도 속초시 번영로 188",
    origin: { latitude: 38.2154164233856, longitude: 128.59031570815 },
    distanceKm: 1.5,
    etaMinutes: 6,
  });
  assert.equal(DISPATCH_ROUTES["GW-STROKE-002"].stationName, "옥천119안전센터");
  assert.equal(DISPATCH_ROUTES["GW-STROKE-003"].stationName, "천곡119안전센터");

  const source = read("components/v2/ParamedicApp.tsx");
  assert.match(source, /getDispatchRoute\(incident\.id\)/);
  assert.match(source, /<KakaoRouteMap origin=\{dispatchRoute\.origin\} destination=\{incident\.scene\}/);
  assert.doesNotMatch(source, /const dispatchOrigins/);
});

test("takes patient contact directly into a concise three-step assessment", () => {
  const source = read("components/v2/ParamedicApp.tsx");
  assert.match(source, /await run\(\(\) => api\.contactPatient\(incident\.id\)\);\s*beginAssessment\(\)/);
  assert.match(source, /incident\.stage === "patient-contact" \? renderAssessment\(\)/);
  assert.doesNotMatch(source, /renderContact/);
  assert.match(source, /assessmentStep === 0 \? "BASIC" : assessmentStep === 1 \? "CPSS" : "VITALS"/);
});

test("uses genuine hold-to-talk with visible live text and automatic structuring", () => {
  const source = read("components/v2/PttInput.tsx");
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.match(source, /onPointerUp=\{handlePointerEnd\}/);
  assert.match(source, /onKeyDown=\{handleKeyDown\}/);
  assert.match(source, /const liveTranscript = remote \? transcribe\.transcript : localTranscript/);
  assert.match(source, /await structureText\(transcript\)/);
  assert.match(source, /선택값 적용/);
  assert.doesNotMatch(source, /선택 항목을 입력 초안에 반영/);
});

test("does not present unselected wheel values as confirmed data", () => {
  const source = read("components/v2/WheelPicker.tsx");
  assert.match(source, />미입력<\/button>/);
  assert.match(source, /data-unset=\{value === undefined\}/);
  assert.match(source, /selected !== undefined && selected !== value/);
});

test("keeps manual choices and measurement limits aligned with the backend contract", () => {
  const source = read("components/v2/ParamedicApp.tsx");
  assert.match(source, /label="기도"[\s\S]*?label: "개방"[\s\S]*?label: "확보 필요"/);
  assert.match(source, /label="호흡"[\s\S]*?label: "자발호흡"[\s\S]*?label: "호흡 이상"/);
  assert.match(source, /label="순환"[\s\S]*?label: "맥박 촉지"[\s\S]*?label: "순환 불안정"/);
  assert.match(source, /label="혈당"[\s\S]*?min=\{10\} max=\{1000\}/);
  assert.equal((source.match(/input type="time"/g) ?? []).length, 3);
  assert.match(source, /className=\{styles\.stickyFormError\}/);
  assert.match(source, /setAssessmentOpen\(false\);\s*\} catch/);
});

test("places compact demo reset before logout without changing hospital callers", () => {
  const source = read("components/v2/Brand.tsx");
  assert.ok(source.indexOf("styles.demoReset") < source.indexOf("styles.logout"));
  assert.match(source, /onDemoReset\?: \(\) => void/);

  const paramedic = read("components/v2/ParamedicApp.tsx");
  assert.match(paramedic, /window\.confirm\("출동 사건 3건을 처음 상태로 되돌릴까요\?/);
  assert.match(paramedic, /await resetDemoCases\(DEMO_RESET_CONFIRMATION\)/);
});
