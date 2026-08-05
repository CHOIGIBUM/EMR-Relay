import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DISPATCH_ROUTES } from "../lib/v2/dispatchRoutes.ts";
import { buildKakaoDirectionsLink } from "../lib/v2/map.ts";

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

test("keeps the assessment stepper in an independent header row", () => {
  const source = read("components/v2/ParamedicApp.tsx");
  const styles = read("components/v2/V2.module.css");

  assert.match(source, /className=\{styles\.assessmentHeader\}[\s\S]*?className=\{styles\.assessmentNav\}[\s\S]*?<\/nav>[\s\S]*?<\/div>\s*<div className=\{styles\.mobileScroll\}>/);
  assert.match(source, /aria-label="환자 상태 입력 단계"/);
  assert.match(source, /aria-current=\{assessmentStep === index \? "step" : undefined\}/);
  assert.match(source, /className=\{styles\.assessmentFooter\}[\s\S]*?styles\.stickyFormError[\s\S]*?styles\.stickyAction/);
  assert.match(styles, /\.assessmentHeader\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*2;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.assessmentFooter\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*5;/);
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

test("opens Kakao car directions with the configured origin and destination", () => {
  const url = buildKakaoDirectionsLink(
    { name: "영랑119안전센터", latitude: 38.2154, longitude: 128.5903 },
    { name: "환자 현장", latitude: 38.2072, longitude: 128.5918 },
  );
  assert.equal(url, "https://map.kakao.com/link/by/car/%EC%98%81%EB%9E%91119%EC%95%88%EC%A0%84%EC%84%BC%ED%84%B0,38.2154,128.5903/%ED%99%98%EC%9E%90%20%ED%98%84%EC%9E%A5,38.2072,128.5918");
  assert.doesNotMatch(url, /\/link\/to\//);
});

test("renders labeled route endpoints, range circles, expansion controls, and acceptance alerts", () => {
  const routeSource = read("components/v2/KakaoRouteMap.tsx");
  const matchMapSource = read("components/v2/HospitalMatchMap.tsx");
  const paramedicSource = read("components/v2/ParamedicApp.tsx");
  assert.match(routeSource, /routeLabelOrigin/);
  assert.match(routeSource, /routeLabelDestination/);
  assert.match(routeSource, /new maps\.Polyline/);
  assert.match(matchMapSource, /new maps\.Circle/);
  assert.match(matchMapSource, /initialHospitalMapLevel\(radiusKm\)/);
  assert.match(matchMapSource, /map\.setMinLevel\(MIN_MAP_LEVEL\)/);
  assert.match(matchMapSource, /map\.setMaxLevel\(MAX_MAP_LEVEL\)/);
  assert.match(matchMapSource, /mapMarkerDot/);
  assert.match(matchMapSource, /mapMarkerInfo/);
  assert.match(matchMapSource, /marker\.etaMinutes/);
  assert.match(matchMapSource, /marker\.distanceKm\.toFixed\(1\)/);
  assert.match(matchMapSource, /map\.panTo\(position\)/);
  assert.match(matchMapSource, /map\.setLevel\(SELECTED_HOSPITAL_LEVEL/);
  assert.doesNotMatch(matchMapSource, /node\.textContent = marker\.name/);
  assert.doesNotMatch(matchMapSource, /map\.setBounds\(bounds\)/);
  assert.match(matchMapSource, /현재 요청 반경 \{radiusKm\}km/);
  assert.match(matchMapSource, /radiusKm === 0 \? " · 실행 전"/);
  assert.match(matchMapSource, /최초 요청 \$\{nextRadiusKm\}km 실행 대기/);
  assert.match(matchMapSource, /수동 확대 · 다음 \$\{nextRadiusKm\}km/);
  assert.match(matchMapSource, /자동 확대 · 다음 \$\{nextRadiusKm\}km/);
  assert.match(matchMapSource, /현재 요청: \{expansionReasonLabel\[expansionReason\]\}/);
  assert.match(matchMapSource, /모두 수용 곤란이면 즉시 확대 · 미회신이 남으면 30초 후 자동 확대/);
  assert.doesNotMatch(matchMapSource, /latitudeDelta|longitudeDelta/);
  assert.ok(paramedicSource.indexOf("요청 범위 확대") < paramedicSource.indexOf("병원 요청 갱신"));
  assert.match(paramedicSource, /matchingState\?\.currentRadiusKm \?\? requestRadius/);
  assert.doesNotMatch(paramedicSource, /matchingState\.currentRadiusKm > 0[\s\S]*?matchingState\.nextRadiusKm/);
  assert.match(paramedicSource, /matchingState\s*\? matchingState\.nextRadiusKm/);
  assert.match(paramedicSource, /nextExpansionAt=\{matchingState\?\.nextExpansionAt\}/);
  assert.match(paramedicSource, /Notification\.requestPermission\(\)/);
  assert.match(paramedicSource, /Notification\.permission === "granted"/);
  assert.match(paramedicSource, /navigator\.vibrate\(\[180, 90, 180\]\)/);
  assert.match(paramedicSource, /store\?\.requests\.filter\(\(request\) => request\.status === "ACCEPTED"\)/);
  assert.match(paramedicSource, /if \(!acceptedTrackingReadyRef\.current\)[\s\S]*?acceptedRequestIdsRef\.current = currentIds/);
  assert.match(paramedicSource, /allAccepted\.filter\(\(request\) => !acceptedRequestIdsRef\.current\.has\(request\.id\)\)/);
  assert.match(paramedicSource, /hospital\?\.location \?\? request\.hospitalLocation/);
  assert.match(paramedicSource, /distanceKm: request\.distanceKm/);
  assert.match(paramedicSource, /etaMinutes: request\.etaMinutes/);
  assert.match(paramedicSource, /destinationHospital\?\.location \?\? destinationRequest\?\.hospitalLocation/);
});

test("moves an accepted hospital selection to the authoritative route stage", () => {
  const source = read("components/v2/ParamedicApp.tsx");
  const styles = read("components/v2/V2.module.css");

  assert.match(source, /const selectDestination = async \(request: HospitalRequest\)/);
  assert.match(source, /await run\(\(\) => api\.selectDestination\(incident\.id, request\.id\)\);[\s\S]*?setMatchingRequestedId\(null\)/);
  assert.match(source, /request\.status !== "ACCEPTED"/);
  assert.match(source, /incident\?\.stage === "matching"[\s\S]*?incident\?\.stage === "card-confirmed" && matchingRequestedId === incident\.id/);
  assert.match(source, /incident\.stage === "patient-contact" \? renderAssessment\(\)[\s\S]*?: showMatching \? renderMatching\(\)[\s\S]*?: incident\.stage === "card-confirmed" \? renderCard\(\)/);
  assert.doesNotMatch(source, /incident\.stage === "matching" \|\| matchingRequestedId === incident\.id/);
  assert.match(styles, /\.responseList article > button \{[\s\S]*?width: 100%;[\s\S]*?display: inline-flex;[\s\S]*?white-space: nowrap;/);
});
