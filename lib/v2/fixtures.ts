import type { DispatchCase, Hospital, HospitalRouteReference, V2Store } from "./types";
import { V2_DEMO_HOSPITALS } from "./hospitalDirectory";

const incidents: DispatchCase[] = [
  {
    id: "GW-STROKE-001",
    code: "EMS Relay-001",
    stage: "assigned",
    reportTime: "08:14",
    reportSummary: "평소와 다른 상태로 도움이 필요함",
    reportDetail: "신고자가 평소와 다르게 보인다고 진술함. 환자 상태는 현장에서 확인합니다.",
    estimatedAge: "70대 추정",
    estimatedSex: "여성 추정",
    reporter: "보호자 신고",
    dispatchUnit: "속초119구급대 1팀",
    station: "속초소방서",
    sceneAddress: "강원특별자치도 속초시 수복로 147",
    scene: { latitude: 38.2072, longitude: 128.5918 },
    assessment: {},
    patientCard: null,
    destinationRequestId: null,
    timeline: {},
    version: 1,
  },
  {
    id: "GW-STROKE-002",
    code: "EMS Relay-002",
    stage: "assigned",
    reportTime: "09:36",
    reportSummary: "의식과 움직임이 평소와 다름",
    reportDetail: "가족이 반응과 움직임의 변화를 신고함. 환자 상태는 현장에서 확인합니다.",
    estimatedAge: "70대 추정",
    estimatedSex: "남성 추정",
    reporter: "배우자 신고",
    dispatchUnit: "고성119구급대 1팀",
    station: "고성소방서",
    sceneAddress: "강원특별자치도 고성군 간성읍 간성로 67",
    scene: { latitude: 38.3806, longitude: 128.4677 },
    assessment: {},
    patientCard: null,
    destinationRequestId: null,
    timeline: {},
    version: 1,
  },
  {
    id: "GW-STROKE-003",
    code: "EMS Relay-003",
    stage: "assigned",
    reportTime: "11:04",
    reportSummary: "반응이 불분명하고 움직이기 어려움",
    reportDetail: "이웃이 평소와 다른 상태를 발견함. 발생 시각과 환자 상태는 현장에서 확인합니다.",
    estimatedAge: "80대 추정",
    estimatedSex: "여성 추정",
    reporter: "이웃 신고",
    dispatchUnit: "양양119구급대 1팀",
    station: "양양소방서",
    sceneAddress: "강원특별자치도 양양군 양양읍 군청길 1",
    scene: { latitude: 38.0754, longitude: 128.6191 },
    assessment: {},
    patientCard: null,
    destinationRequestId: null,
    timeline: {},
    version: 1,
  },
];

const hospitals: Hospital[] = [...V2_DEMO_HOSPITALS];

const perCase: Record<string, Array<[string, number, number, number]>> = {
  "GW-STROKE-001": [
    ["A2200012", 1, 1.8, 5],
    ["A2200011", 2, 70.6, 61],
    ["A2200003", 3, 105.1, 84],
  ],
  "GW-STROKE-002": [
    ["A2200012", 1, 23.8, 34],
    ["A2200011", 2, 98.8, 84],
    ["A2200003", 3, 133.2, 106],
  ],
  "GW-STROKE-003": [
    ["A2200012", 1, 18.8, 30],
    ["A2200011", 2, 51.1, 41],
    ["A2200003", 3, 85.6, 64],
  ],
};

const routes: HospitalRouteReference[] = Object.entries(perCase).flatMap(([caseId, entries]) => entries.map(([hospitalId, wave, distanceKm, etaMinutes]) => ({
  caseId,
  hospitalId,
  wave,
  distanceKm,
  etaMinutes,
})));

export function createInitialV2Store(): V2Store {
  return structuredClone({
    cases: incidents,
    hospitals,
    routes,
    requests: [],
    updatedAt: new Date().toISOString(),
  });
}
