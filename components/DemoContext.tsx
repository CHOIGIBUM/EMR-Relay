"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CARDIO_DEMO_DISPATCH,
  CARDIO_DEMO_HANDOFF,
  CARDIO_DEMO_HOSPITALS,
  CARDIO_DEMO_PATIENT,
  CARDIO_DEMO_PTT_UPDATES,
  CARDIO_DEMO_REPORT_DRAFT,
  CARDIO_DEMO_VITALS,
  type CardioPttProposal,
} from "@/lib/cardioDemoData";
import {
  CaseRealtimeClient,
  confirmDirectFacts,
  createReportDraft,
  finalizeReport,
  getCaseSnapshot,
  OPERATIONAL_CONFIG,
  submitCaseCommand,
  reviewReport,
} from "@/lib/operationalApi";
import type { OperationalCaseSnapshot, OperationalReport, OperationalRole } from "@/lib/operationalTypes";
import { EmsApiError, getHospitalDirectory } from "@/lib/emsApi";
import { currentAccessToken } from "@/lib/cognitoAuth";

export type DemoStage =
  | "assigned"
  | "enroute"
  | "scene-arrived"
  | "patient-contact"
  | "assessing"
  | "summary-ready"
  | "coordination-requested"
  | "hospital-requested"
  | "info-requested"
  | "info-sent"
  | "declined"
  | "accepted"
  | "destination-confirmed"
  | "transporting"
  | "hospital-arrived"
  | "handoff-sent"
  | "complete";

export type Actor = "119 상황실" | "구급대원" | "이송조정 상황실" | "병원" | "시스템";
export type EventTone = "neutral" | "teal" | "amber" | "red";
export type FactState = "confirmed" | "unconfirmed" | "unknown" | "pending_review";
export type ReportStatus = "locked" | "ready" | "draft" | "reviewed" | "closed";

export type DemoEvent = {
  id: number;
  time: string;
  actor: Actor;
  title: string;
  detail: string;
  tone?: EventTone;
};

export type VitalValues = {
  bp: string;
  pr: string;
  rr: string;
  spo2: string;
  temp: string;
  glucose: string;
};

export type ConfirmedFact = CardioPttProposal & {
  confirmedAt: string;
};

export type HospitalOption = {
  id: string;
  name: string;
  type: string;
  distance: string;
  eta: string;
  distanceKm?: number | null;
  etaMinutes?: number | null;
  location: string;
  reference: string[];
  address?: string;
  latitude?: number;
  longitude?: number;
  routeSource?: "kakao_mobility_live" | "kakao_mobility_snapshot" | "local_straight_line_estimate" | "unavailable";
  routeIsLive?: boolean;
  isRoadRoute?: boolean;
};

const formatClock = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(iso));

export type ScenarioView = {
  id: string;
  sourceCaseId: string;
  unit: string;
  unitBase?: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  locationName?: string;
  sceneLocation?: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  location: string;
  locationShort: string;
  latitude?: number;
  longitude?: number;
  routeToScene?: {
    distanceKm: number;
    etaMinutes: number;
    source: "kakao_mobility_live" | "kakao_mobility_snapshot";
    isLive: boolean;
  };
  access: string;
  caller: string;
  callerPhone: string;
  reportedPatient: string;
  reportedComplaint: string;
  patient: string;
  living: string;
  chiefComplaint: string;
  baseline: string;
  onset: string;
  onsetSource: string;
  symptoms: string[];
  pain: { severityNrs: number | "미확인"; quality: string; region: string; radiation: string; provocation: string };
  history: string[];
  medication: string;
  allergy: string;
  avpu: "미확인" | "A" | "V" | "P" | "U";
  primarySurvey: {
    airway: string;
    breathing: string;
    circulation: string;
  };
  impression: string;
  impressionStatus: FactState;
  interventions: string[];
  unresolvedItems: string[];
};

export const SCENARIO: ScenarioView = {
  id: CARDIO_DEMO_DISPATCH.displayId,
  sourceCaseId: CARDIO_DEMO_DISPATCH.caseId,
  unit: CARDIO_DEMO_DISPATCH.assignedUnit,
  unitBase: { ...CARDIO_DEMO_DISPATCH.unitBase },
  locationName: CARDIO_DEMO_DISPATCH.location.name,
  sceneLocation: {
    name: CARDIO_DEMO_DISPATCH.location.name,
    address: CARDIO_DEMO_DISPATCH.location.displayAddress,
    latitude: CARDIO_DEMO_DISPATCH.location.latitude,
    longitude: CARDIO_DEMO_DISPATCH.location.longitude,
  },
  location: CARDIO_DEMO_DISPATCH.location.displayAddress,
  locationShort: CARDIO_DEMO_DISPATCH.location.sigungu,
  latitude: CARDIO_DEMO_DISPATCH.location.latitude,
  longitude: CARDIO_DEMO_DISPATCH.location.longitude,
  routeToScene: {
    distanceKm: CARDIO_DEMO_DISPATCH.routeToScene.distanceKm,
    etaMinutes: CARDIO_DEMO_DISPATCH.routeToScene.etaMinutes,
    source: CARDIO_DEMO_DISPATCH.routeToScene.source,
    isLive: CARDIO_DEMO_DISPATCH.routeToScene.isLive,
  },
  access: `${CARDIO_DEMO_DISPATCH.location.setting} · 신고자 현장 대기`,
  caller: CARDIO_DEMO_DISPATCH.callerRelation,
  callerPhone: "010-42**-11**",
  reportedPatient: `${CARDIO_DEMO_DISPATCH.reportedAgeBand} 여성`,
  reportedComplaint: CARDIO_DEMO_DISPATCH.reportedComplaint,
  patient: `${CARDIO_DEMO_PATIENT.ageYears}세 ${CARDIO_DEMO_PATIENT.sexLabel}`,
  living: `${CARDIO_DEMO_PATIENT.baselineFunction} · 현장 확인`,
  chiefComplaint: CARDIO_DEMO_PATIENT.chiefComplaint,
  baseline: CARDIO_DEMO_PATIENT.baselineFunction,
  onset: formatClock(CARDIO_DEMO_PATIENT.onsetAt),
  onsetSource: "환자·목격자 진술",
  symptoms: [...CARDIO_DEMO_PATIENT.symptoms],
  pain: { ...CARDIO_DEMO_PATIENT.pain },
  history: [...CARDIO_DEMO_PATIENT.history.conditions],
  medication: `${CARDIO_DEMO_PATIENT.history.medicationName} 복용 진술 · 확인 필요`,
  allergy: CARDIO_DEMO_PATIENT.history.allergyLabel,
  avpu: CARDIO_DEMO_PATIENT.initialAssessment.avpu,
  primarySurvey: {
    airway: CARDIO_DEMO_PATIENT.initialAssessment.airway.replace(/^기도\s*/, ""),
    breathing: CARDIO_DEMO_PATIENT.initialAssessment.breathing,
    circulation: CARDIO_DEMO_PATIENT.initialAssessment.circulation,
  },
  impression: CARDIO_DEMO_PATIENT.prehospitalImpressionLabel,
  impressionStatus: CARDIO_DEMO_PATIENT.impressionStatus,
  interventions: ["심전도 감시", "12유도 심전도", "정맥로 확보"],
  unresolvedItems: [...CARDIO_DEMO_PATIENT.unresolvedItems],
};

function createOperationalScenario(caseId: string): ScenarioView {
  return {
    id: caseId,
    sourceCaseId: caseId,
    unit: "배정 정보 미확인",
    location: "현장 위치 확인 필요",
    locationShort: "위치 미확인",
    access: "현장 확인 필요",
    caller: "미확인",
    callerPhone: "미확인",
    reportedPatient: "신고 환자정보 미확인",
    reportedComplaint: "신고 내용 미확인",
    patient: "환자정보 미확인",
    living: "현장 확인 필요",
    chiefComplaint: "미확인",
    baseline: "미확인",
    onset: "미확인",
    onsetSource: "근거 확인 필요",
    symptoms: [],
    pain: { severityNrs: "미확인", quality: "미확인", region: "미확인", radiation: "미확인", provocation: "미확인" },
    history: [],
    medication: "미확인",
    allergy: "미확인",
    avpu: "미확인",
    primarySurvey: { airway: "미확인", breathing: "미확인", circulation: "미확인" },
    impression: "병원 전 평가 미확인",
    impressionStatus: "unknown",
    interventions: [],
    unresolvedItems: [],
  };
}

export const REQUIRED_ASSESSMENT_PATHS_BY_STEP = {
  1: [
    "assessment.airway",
    "assessment.breathing",
    "assessment.circulation",
    "consciousness.avpu",
    "symptoms.chiefComplaint",
  ],
  2: [
    "symptoms.onsetAt",
    "symptoms.chestPainNrs",
    "symptoms.chestPainQuality",
    "symptoms.chestPainRadiation",
    "symptoms.associated",
  ],
  3: [
    "vitals.systolicBp",
    "vitals.diastolicBp",
    "vitals.pulse",
    "vitals.respiratoryRate",
    "vitals.spo2",
    "vitals.temperature",
    "vitals.glucose",
  ],
} as const;

function hasUsableFactValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

export function completedAssessmentSequences(paths: ReadonlySet<string>) {
  return ([1, 2, 3] as const).filter((step) => (
    REQUIRED_ASSESSMENT_PATHS_BY_STEP[step].every((path) => paths.has(path))
  ));
}

export const HOSPITALS: HospitalOption[] = CARDIO_DEMO_HOSPITALS.map((hospital) => ({
  id: hospital.id,
  name: hospital.alias,
  type: hospital.careLevelLabel,
  distance: `${hospital.distanceKm.toFixed(1)} km`,
  eta: `${hospital.etaMinutes}분`,
  distanceKm: hospital.distanceKm,
  etaMinutes: hospital.etaMinutes,
  location: hospital.regionLabel,
  reference: [...hospital.referenceCapabilities],
  address: hospital.address,
  latitude: hospital.latitude,
  longitude: hospital.longitude,
  routeSource: hospital.routeSource,
  routeIsLive: false,
  isRoadRoute: true,
}));

export const STAGE_LABEL: Record<DemoStage, string> = {
  assigned: "출동 배정",
  enroute: "출동 중",
  "scene-arrived": "현장 도착",
  "patient-contact": "환자 접촉",
  assessing: "현장평가 중",
  "summary-ready": "확인본 준비",
  "coordination-requested": "상황실 지원",
  "hospital-requested": "병원 회신 대기",
  "info-requested": "추가정보 요청",
  "info-sent": "추가정보 회신",
  declined: "수용 곤란",
  accepted: "수용 가능",
  "destination-confirmed": "이송지 확정",
  transporting: "이송 중",
  "hospital-arrived": "병원 도착",
  "handoff-sent": "인수 확인 대기",
  complete: "환자 인수 완료",
};

export const FLOW_STAGES: DemoStage[] = [
  "assigned",
  "enroute",
  "scene-arrived",
  "patient-contact",
  "assessing",
  "summary-ready",
  "coordination-requested",
  "hospital-requested",
  "info-requested",
  "info-sent",
  "accepted",
  "destination-confirmed",
  "transporting",
  "hospital-arrived",
  "handoff-sent",
  "complete",
];

export type DemoState = {
  stage: DemoStage;
  vitals: VitalValues;
  vitalsConfirmed: boolean;
  avpu: "미확인" | "A" | "V" | "P" | "U";
  cardioConfirmed: boolean;
  voiceConfirmed: boolean;
  confirmedPttIds: string[];
  confirmedFacts: Record<string, ConfirmedFact>;
  rejectedProposalIds: string[];
  selectedHospitalId: string | null;
  activeHospitalRequestId: string | null;
  declinedHospitalIds: string[];
  requestedInfo: string[];
  infoReply: string | null;
  hospitalViewed: boolean;
  destinationConfirmed: boolean;
  reassessmentSaved: boolean;
  reassessmentVitals: VitalValues | null;
  reassessmentSummary: string;
  handoffReceiver: string;
  handoffRole: string;
  reportStatus: ReportStatus;
  reportReviewedIds: string[];
  events: DemoEvent[];
};

function formatEventTime(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function createInitialEvents(): DemoEvent[] {
  return [
    {
      id: 1,
      time: formatClock(CARDIO_DEMO_DISPATCH.callReceivedAt),
      actor: "119 상황실",
      title: "119 신고 접수",
      detail: `${CARDIO_DEMO_DISPATCH.callerRelation} 신고 · ${CARDIO_DEMO_DISPATCH.reportedComplaint}`,
    },
    {
      id: 2,
      time: formatClock(CARDIO_DEMO_DISPATCH.dispatchAssignedAt),
      actor: "119 상황실",
      title: "구급대 출동 지령",
      detail: `${CARDIO_DEMO_DISPATCH.assignedUnit} 배정`,
      tone: "teal",
    },
  ];
}

function emptyVitals(): VitalValues {
  return { bp: "", pr: "", rr: "", spo2: "", temp: "", glucose: "" };
}

function initialState(): DemoState {
  return {
    stage: "assigned",
    vitals: emptyVitals(),
    vitalsConfirmed: false,
    avpu: "미확인",
    cardioConfirmed: false,
    voiceConfirmed: false,
    confirmedPttIds: [],
    confirmedFacts: {},
    rejectedProposalIds: [],
    selectedHospitalId: null,
    activeHospitalRequestId: null,
    declinedHospitalIds: [],
    requestedInfo: [],
    infoReply: null,
    hospitalViewed: false,
    destinationConfirmed: false,
    reassessmentSaved: false,
    reassessmentVitals: null,
    reassessmentSummary: "미확인",
    handoffReceiver: "",
    handoffRole: "간호사",
    reportStatus: "locked",
    reportReviewedIds: [],
    events: createInitialEvents(),
  };
}

function operationalInitialState(): DemoState {
  return {
    ...initialState(),
    handoffRole: "",
    events: [],
  };
}

const STORAGE_KEY = "ems-relay:cardio-mvp-state:v5";
const CHANNEL_NAME = "ems-relay:cardio-mvp-state:v5";
const OFFICIAL_REPORT_REVIEW_FIELDS = [
  "patientIdentity",
  "symptomsAndOccurrence",
  "patientAssessment",
  "paramedicAssessment",
  "emergencyCare",
  "medicalDirection",
  "transport",
  "handoff",
];

type Action = (
  | { type: "RESET" }
  | { type: "TRANSITION"; stage: DemoStage; actor: Actor; title: string; detail: string; tone?: EventTone }
  | { type: "LOAD_VITALS" }
  | { type: "SET_VITAL"; key: keyof VitalValues; value: string }
  | { type: "SET_AVPU"; value: DemoState["avpu"] }
  | {
      type: "CONFIRM_PTT";
      updateId: string;
      acceptedProposalIds: string[];
      rejectedProposalIds?: string[];
      reviewedProposals?: readonly CardioPttProposal[];
    }
  | { type: "CONFIRM_ASSESSMENT" }
  | { type: "REQUEST_COORDINATION" }
  | { type: "REQUEST_HOSPITAL"; hospitalId: string }
  | { type: "CALL_HOSPITAL"; hospitalId: string; result?: string }
  | { type: "MARK_HOSPITAL_VIEWED" }
  | { type: "REQUEST_INFO"; fields: string[] }
  | { type: "ANSWER_INFO" }
  | { type: "DECLINE"; reason: string }
  | { type: "ACCEPT" }
  | { type: "CONFIRM_DESTINATION" }
  | { type: "SAVE_REASSESSMENT"; values?: VitalValues; symptomTrend?: string }
  | { type: "SET_HANDOFF"; receiver: string; role: string }
  | { type: "RECEIVE_PATIENT"; receiver: string; role: string }
  | { type: "CREATE_REPORT" }
  | { type: "TOGGLE_REPORT_REVIEW"; reviewId: string }
  | { type: "MARK_REPORT_REVIEWED"; reviewedFields?: string[] }
  | { type: "CLOSE_CASE" }
) & { occurredAt?: string };

function appendEvent(state: DemoState, event: Omit<DemoEvent, "id">): DemoState {
  return { ...state, events: [...state.events, { ...event, id: state.events.length + 1 }] };
}

function vitalValuesAt(index: number): VitalValues {
  const vital = CARDIO_DEMO_VITALS[index];
  return {
    bp: `${vital.bloodPressure.systolic}/${vital.bloodPressure.diastolic}`,
    pr: String(vital.heartRate.value),
    rr: String(vital.respiratoryRate.value),
    spo2: String(vital.spo2.value),
    temp: String(vital.temperature.value),
    glucose: String(vital.bloodGlucose.value),
  };
}

function vitalSummary(values: VitalValues) {
  return `BP ${values.bp} mmHg · PR ${values.pr}회/분 · RR ${values.rr}회/분 · SpO₂ ${values.spo2}% · 혈당 ${values.glucose} mg/dL`;
}

function numericText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value.trim();
  return null;
}

function applyVitalProposals(base: VitalValues, proposals: readonly CardioPttProposal[]): VitalValues {
  const next = { ...base };
  let [systolic = "", diastolic = ""] = next.bp.split("/");

  for (const proposal of proposals) {
    const path = proposal.fieldPath ?? "";
    const value = numericText(proposal.rawValue);
    if (path === "vitals.systolicBp" && value) systolic = value;
    if (path === "vitals.diastolicBp" && value) diastolic = value;
    if (path === "vitals.pulse" && value) next.pr = value;
    if (path === "vitals.respiratoryRate" && value) next.rr = value;
    if (path === "vitals.spo2" && value) next.spo2 = value;
    if (path === "vitals.temperature" && value) next.temp = value;
    if (path === "vitals.glucose" && value) next.glucose = value;

    if ((path === "vitals.initial" || path === "vitals.reassessment")
      && proposal.rawValue && typeof proposal.rawValue === "object" && !Array.isArray(proposal.rawValue)) {
      const raw = proposal.rawValue as Record<string, unknown>;
      systolic = numericText(raw.sbp_mmHg) ?? systolic;
      diastolic = numericText(raw.dbp_mmHg) ?? diastolic;
      next.pr = numericText(raw.heart_rate_per_min) ?? next.pr;
      next.rr = numericText(raw.respiratory_rate_per_min) ?? next.rr;
      next.spo2 = numericText(raw.spo2_percent) ?? next.spo2;
      next.temp = numericText(raw.temperature_celsius) ?? next.temp;
      next.glucose = numericText(raw.blood_glucose_mg_dL) ?? next.glucose;
    }
  }
  next.bp = systolic && diastolic ? `${systolic}/${diastolic}` : "";
  return next;
}

function hasCompleteVitalSet(values: VitalValues) {
  return Boolean(values.bp && values.pr && values.rr && values.spo2 && values.temp && values.glucose);
}

function confirmPtt(
  state: DemoState,
  updateId: string,
  acceptedProposalIds: string[],
  rejectedProposalIds: string[],
  occurredAt: string,
  reviewedProposals?: readonly CardioPttProposal[],
): DemoState {
  const update = CARDIO_DEMO_PTT_UPDATES.find((item) => item.id === updateId);
  if ((!update && !reviewedProposals) || state.confirmedPttIds.includes(updateId)) return state;

  const proposals: readonly CardioPttProposal[] = reviewedProposals ?? update?.proposals ?? [];
  const accepted = proposals.filter((proposal) => acceptedProposalIds.includes(proposal.id));
  const facts = { ...state.confirmedFacts };
  for (const proposal of accepted) {
    facts[proposal.id] = {
      ...proposal,
      status: proposal.status === "pending_review" ? "confirmed" : proposal.status,
      confirmedAt: occurredAt,
    };
  }

  const confirmedPaths = new Set(Object.values(facts)
    .filter((fact) => hasUsableFactValue(fact.rawValue))
    .map((fact) => fact.fieldPath)
    .filter((path): path is string => Boolean(path)));
  const completedSequences = completedAssessmentSequences(confirmedPaths);
  const inferredSequence = update?.sequence ?? (() => {
    const match = updateId.match(/-U0([1-4])$/);
    return match ? Number(match[1]) as 1 | 2 | 3 | 4 : null;
  })();
  const updateComplete = inferredSequence === 4 || (inferredSequence !== null && completedSequences.includes(inferredSequence));
  const confirmedPttIds = updateComplete
    ? [...new Set([...state.confirmedPttIds, updateId])]
    : state.confirmedPttIds;
  const firstThreeConfirmed = completedSequences.length === 3;
  const isInitialVitals = accepted.some((item) => item.fieldPath?.startsWith("vitals.") || item.id === "U03-vitals");
  const isReassessment = accepted.some((item) => item.fieldPath?.startsWith("reassessment.") || item.fieldPath === "transport.reassessment" || item.id === "U04-vitals");
  const initialVitals = isInitialVitals ? applyVitalProposals(state.vitals, accepted) : state.vitals;
  const reassessmentVitals = isReassessment
    ? applyVitalProposals(state.reassessmentVitals ?? emptyVitals(), accepted)
    : state.reassessmentVitals;
  const avpuProposal = accepted.find((item) => item.fieldPath === "consciousness.avpu" || item.fieldPath === "reassessment.avpu" || item.id === "U01-avpu");
  const nextAvpu = avpuProposal && ["A", "V", "P", "U"].includes(String(avpuProposal.rawValue))
    ? String(avpuProposal.rawValue) as "A" | "V" | "P" | "U"
    : state.avpu;

  let next: DemoState = {
    ...state,
    stage: state.stage === "patient-contact" ? "assessing" : state.stage,
    confirmedPttIds,
    confirmedFacts: facts,
    rejectedProposalIds: [...new Set([...state.rejectedProposalIds, ...rejectedProposalIds])],
    voiceConfirmed: firstThreeConfirmed,
    cardioConfirmed: firstThreeConfirmed,
    vitals: initialVitals,
    vitalsConfirmed: completedSequences.includes(3),
    avpu: nextAvpu,
    reassessmentSaved: (isReassessment && reassessmentVitals !== null && hasCompleteVitalSet(reassessmentVitals)) || state.reassessmentSaved,
    reassessmentVitals,
    reassessmentSummary: isReassessment
      ? String(accepted.find((item) => item.fieldPath === "transport.reassessment")?.rawValue ?? state.reassessmentSummary)
      : state.reassessmentSummary,
  };

  next = appendEvent(next, {
    time: occurredAt,
    actor: "구급대원",
    title: `${update?.title ?? "환자 상태 음성 입력"} 확인`,
    detail: `제안 ${accepted.length}건 반영${rejectedProposalIds.length ? ` · ${rejectedProposalIds.length}건 제외` : ""}${updateComplete ? " · 단계 완료" : " · 필수항목 확인 필요"}`,
    tone: (update?.needsReview ?? true) ? "amber" : "teal",
  });
  return next;
}

function reducer(state: DemoState, action: Action): DemoState {
  const occurredAt = action.occurredAt ?? formatEventTime();
  switch (action.type) {
    case "RESET":
      return initialState();
    case "TRANSITION":
      return appendEvent(
        { ...state, stage: action.stage },
        { time: occurredAt, actor: action.actor, title: action.title, detail: action.detail, tone: action.tone },
      );
    case "LOAD_VITALS":
      {
        const values = vitalValuesAt(0);
      return appendEvent(
        { ...state, stage: "assessing", vitals: values, vitalsConfirmed: true, avpu: "A" },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "최초 활력징후 확인",
          detail: vitalSummary(values),
          tone: "teal",
        },
      );
      }
    case "SET_VITAL":
      return { ...state, vitals: { ...state.vitals, [action.key]: action.value } };
    case "SET_AVPU":
      return { ...state, avpu: action.value };
    case "CONFIRM_PTT":
      return confirmPtt(
        state,
        action.updateId,
        action.acceptedProposalIds,
        action.rejectedProposalIds ?? [],
        occurredAt,
        action.reviewedProposals,
      );
    case "CONFIRM_ASSESSMENT":
      if (!([1, 2, 3] as const).every((sequence) => state.confirmedPttIds.some((id) => id.endsWith(`-U0${sequence}`)))) return state;
      return appendEvent(
        { ...state, stage: "summary-ready", cardioConfirmed: true },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "환자 확인본 생성",
          detail: `${SCENARIO.impression} · 확정 진단 아님 · 미상 항목 ${SCENARIO.unresolvedItems.length}건`,
          tone: "teal",
        },
      );
    case "REQUEST_COORDINATION":
      return appendEvent(
        { ...state, stage: "coordination-requested" },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "상황실 지원 요청",
          detail: "장거리 이송 및 병원 연락 지원 요청",
          tone: "amber",
        },
      );
    case "REQUEST_HOSPITAL": {
      const hospital = HOSPITALS.find((item) => item.id === action.hospitalId);
      const requestActive = ["hospital-requested", "info-requested", "info-sent", "accepted", "destination-confirmed"].includes(state.stage);
      if (!hospital || requestActive || state.declinedHospitalIds.includes(hospital.id)) return state;
      return appendEvent(
        {
          ...state,
          stage: "hospital-requested",
          selectedHospitalId: hospital.id,
          activeHospitalRequestId: `REQ-DEMO-${hospital.id}-${state.events.length + 1}`,
          requestedInfo: [],
          infoReply: null,
          hospitalViewed: false,
          destinationConfirmed: false,
        },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "병원 수용 문의",
          detail: `${hospital.name} · 확정 환자정보와 ETA ${hospital.eta} 전달`,
          tone: "amber",
        },
      );
    }
    case "CALL_HOSPITAL": {
      const hospital = HOSPITALS.find((item) => item.id === action.hospitalId);
      if (!hospital) return state;
      return appendEvent(state, {
        time: occurredAt,
        actor: "구급대원",
        title: "병원 전화 연결",
        detail: `${hospital.name} · ${action.result?.trim() || "전화 연결 시도"}`,
      });
    }
    case "MARK_HOSPITAL_VIEWED":
      if (state.hospitalViewed) return state;
      return appendEvent(
        { ...state, hospitalViewed: true },
        { time: occurredAt, actor: "병원", title: "수용 요청 열람", detail: "병원 담당자가 확인본을 열람" },
      );
    case "REQUEST_INFO":
      return appendEvent(
        { ...state, stage: "info-requested", requestedInfo: action.fields },
        { time: occurredAt, actor: "병원", title: "추가정보 요청", detail: action.fields.join(" · "), tone: "amber" },
      );
    case "ANSWER_INFO": {
      const values = vitalValuesAt(1);
      const update = CARDIO_DEMO_PTT_UPDATES[3];
      const afterReview = confirmPtt(state, update.id, update.proposals.map((item) => item.id), [], occurredAt);
      return appendEvent(
        {
          ...afterReview,
          stage: "info-sent",
          infoReply: `재평가 ${vitalSummary(values)} · ${SCENARIO.medication} · 12유도 심전도 상세 소견 미상`,
        },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "추가정보 회신",
          detail: "확정값과 미상 상태를 구분해 회신",
          tone: "teal",
        },
      );
    }
    case "DECLINE": {
      const hospital = HOSPITALS.find((item) => item.id === state.selectedHospitalId);
      return appendEvent(
        {
          ...state,
          stage: "declined",
          declinedHospitalIds: state.selectedHospitalId
            ? [...new Set([...state.declinedHospitalIds, state.selectedHospitalId])]
            : state.declinedHospitalIds,
        },
        {
          time: occurredAt,
          actor: "병원",
          title: "수용 곤란 회신",
          detail: `${hospital?.name ?? "요청 병원"} · ${action.reason}`,
          tone: "red",
        },
      );
    }
    case "ACCEPT": {
      const hospital = HOSPITALS.find((item) => item.id === state.selectedHospitalId);
      return appendEvent(
        { ...state, stage: "accepted" },
        {
          time: occurredAt,
          actor: "병원",
          title: "수용 가능 회신",
          detail: `${hospital?.name ?? "요청 병원"} · 수용 가능 회신이 공유되었습니다.`,
          tone: "teal",
        },
      );
    }
    case "CONFIRM_DESTINATION":
      if (state.stage !== "accepted" || !state.selectedHospitalId) return state;
      return appendEvent(
        { ...state, stage: "destination-confirmed", destinationConfirmed: true },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "이송지 확인",
          detail: HOSPITALS.find((item) => item.id === state.selectedHospitalId)?.name ?? "수용 병원",
          tone: "teal",
        },
      );
    case "SAVE_REASSESSMENT": {
      const update = CARDIO_DEMO_PTT_UPDATES[3];
      const values = action.values ?? vitalValuesAt(1);
      const symptomTrend = action.symptomTrend?.trim() || "흉통 및 식은땀 일부 호전";
      const confirmedFromVoice = confirmPtt(state, update.id, update.proposals.map((item) => item.id), [], occurredAt);
      const confirmed = {
        ...confirmedFromVoice,
        reassessmentSaved: true,
        reassessmentVitals: values,
        reassessmentSummary: symptomTrend,
      };
      if (confirmed === state) return state;
      return appendEvent(confirmed, {
        time: occurredAt,
        actor: "구급대원",
        title: "이송 중 재평가",
        detail: `${vitalSummary(values)} · ${symptomTrend}`,
        tone: "teal",
      });
    }
    case "SET_HANDOFF":
      return appendEvent(
        { ...state, stage: "handoff-sent", handoffReceiver: action.receiver, handoffRole: action.role },
        {
          time: occurredAt,
          actor: "구급대원",
          title: "구두·전자 인계 완료",
          detail: "IMIST-AMBO 인계문 전달 · 병원 인수 확인 대기",
          tone: "teal",
        },
      );
    case "RECEIVE_PATIENT":
      return appendEvent(
        {
          ...state,
          stage: "complete",
          handoffReceiver: action.receiver,
          handoffRole: action.role,
          reportStatus: "ready",
        },
        {
          time: occurredAt,
          actor: "병원",
          title: "환자 인수 확인",
          detail: `${action.role} ${action.receiver || "담당자"} · 인계 완료`,
          tone: "teal",
        },
      );
    case "CREATE_REPORT":
      if (state.reportStatus === "locked") return state;
      return appendEvent(
        { ...state, reportStatus: "draft" },
        {
          time: occurredAt,
          actor: "시스템",
          title: "보고서 초안 생성",
          detail: `${CARDIO_DEMO_REPORT_DRAFT.completion.autoFilledFields}/${CARDIO_DEMO_REPORT_DRAFT.completion.totalFields}개 항목 자동 작성`,
          tone: "teal",
        },
      );
    case "TOGGLE_REPORT_REVIEW":
      return {
        ...state,
        reportReviewedIds: state.reportReviewedIds.includes(action.reviewId)
          ? state.reportReviewedIds.filter((id) => id !== action.reviewId)
          : [...state.reportReviewedIds, action.reviewId],
      };
    case "MARK_REPORT_REVIEWED":
      if (state.reportReviewedIds.length < CARDIO_DEMO_REPORT_DRAFT.reviewItems.length) return state;
      return appendEvent(
        { ...state, reportStatus: "reviewed" },
        { time: occurredAt, actor: "구급대원", title: "보고서 검토 완료", detail: "확인 필요 항목 검토 완료", tone: "teal" },
      );
    case "CLOSE_CASE":
      if (state.reportStatus !== "reviewed") return state;
      return appendEvent(
        { ...state, reportStatus: "closed" },
        { time: occurredAt, actor: "구급대원", title: "사건 기록 종료", detail: "보고서 초안 승인 · 사건 잠금", tone: "teal" },
      );
    default:
      return state;
  }
}

type ManagedState = { value: DemoState; origin: "initial" | "local" | "hydrate" | "remote"; revision: number };
type ManagedAction =
  | { type: "LOCAL"; action: Action }
  | { type: "REPLACE"; state: DemoState; origin: "hydrate" | "remote" }
  | { type: "SNAPSHOT"; snapshot: OperationalCaseSnapshot };

function managedReducer(state: ManagedState, action: ManagedAction): ManagedState {
  if (action.type === "REPLACE") return { value: action.state, origin: action.origin, revision: state.revision + 1 };
  if (action.type === "SNAPSHOT") return { value: snapshotToState(action.snapshot), origin: "remote", revision: state.revision + 1 };
  const next = reducer(state.value, action.action);
  if (next === state.value) return state;
  return { value: next, origin: "local", revision: state.revision + 1 };
}

function readStoredState(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.events) || !Array.isArray(parsed.confirmedPttIds)) return null;
    return { ...initialState(), ...parsed } as DemoState;
  } catch {
    return null;
  }
}

type DemoContextValue = {
  state: DemoState;
  scenario: ScenarioView;
  hospitals: HospitalOption[];
  selectedHospital: HospitalOption | null;
  progress: number;
  sync: {
    mode: "demo" | "operational" | "remote";
    connection: "local" | "loading" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
    pending: boolean;
    error: string | null;
    waitingForRequest: boolean;
    version: number;
    confirmedVersion: number;
    report?: OperationalReport;
    refresh: () => Promise<void>;
  };
  dispatch: React.Dispatch<Action>;
  reset: () => void;
  transition: (stage: DemoStage, actor: Actor, title: string, detail: string, tone?: EventTone) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

function backendActor(role: string): Actor {
  if (role === "paramedic") return "구급대원";
  if (role === "hospital") return "병원";
  if (role === "control") return "이송조정 상황실";
  return "시스템";
}

function backendEventTitle(type: string, payload: Record<string, unknown>) {
  const titles: Record<string, string> = {
    CASE_ASSIGNED: "구급대 출동 지령",
    DISPATCH_STARTED: "출동 시작",
    ARRIVED_SCENE: "현장 도착",
    PATIENT_CONTACT: "환자 접촉",
    PATIENT_FACTS_CONFIRMED: "환자 확인본 생성",
    HOSPITAL_REQUEST_CREATED: "병원 수용 문의",
    HOSPITAL_REQUEST_VIEWED: "수용 요청 열람",
    ADDITIONAL_INFO_REQUESTED: "추가정보 요청",
    ADDITIONAL_INFO_SENT: "추가정보 회신",
    DESTINATION_CONFIRMED_BY_PARAMEDIC: "이송지 확인",
    TRANSPORT_STARTED: "이송 시작",
    REASSESSMENT_CONFIRMED: "이송 중 재평가",
    ARRIVED_HOSPITAL: "병원 도착",
    HANDOFF_SENT: "구두·전자 인계 완료",
    HANDOFF_ACCEPTED: "환자 인수 확인",
    REPORT_DRAFTED: "보고서 초안 생성",
    REPORT_REVIEWED: "보고서 검토 완료",
    REPORT_FINALIZED: "사건 기록 종료",
  };
  if (type === "HOSPITAL_RESPONSE_RECORDED") return payload.decision === "DECLINED" ? "수용 곤란 회신" : "수용 가능 회신";
  return titles[type] ?? type;
}

export function operationalPttUpdateId(caseId: string, sequence: 1 | 2 | 3 | 4) {
  return `${caseId}-U0${sequence}`;
}

export function snapshotToScenario(snapshot: OperationalCaseSnapshot, previous: ScenarioView): ScenarioView {
  const empty = createOperationalScenario(snapshot.caseId);
  const facts = snapshot.confirmedState.facts;
  const fact = (path: string) => facts[path]?.value;
  const text = (path: string) => {
    const value = fact(path);
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  };
  const textOrList = (path: string) => {
    const value = fact(path);
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (typeof value === "string" || typeof value === "number") return [String(value).trim()].filter(Boolean);
    return [];
  };
  const assignedEvent = snapshot.events?.find((event) => event.type === "CASE_ASSIGNED");
  const assigned = assignedEvent?.payload ?? {};
  const assignedText = (key: string) => {
    const value = assigned[key];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };
  const assignedNumber = (key: string) => {
    const value = assigned[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const assignedRecord = (key: string) => {
    const value = assigned[key];
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  };
  const age = text("patient.age");
  const rawSex = text("patient.sex");
  const sex = rawSex === "female" ? "여성" : rawSex === "male" ? "남성" : rawSex;
  const patient = [age ? `${age}세` : "", sex].filter(Boolean).join(" ") || empty.patient;
  const onsetRaw = text("symptoms.onsetAt");
  let onset = empty.onset;
  if (onsetRaw) {
    const parsed = new Date(onsetRaw);
    onset = Number.isNaN(parsed.getTime()) ? onsetRaw : formatClock(parsed.toISOString());
  }
  const symptoms = textOrList("symptoms.associated");
  const conditions = textOrList("history.conditions");
  const medications = textOrList("history.medications");
  const allergyValue = fact("history.allergies");
  const allergy = Array.isArray(allergyValue) ? allergyValue.join(" · ") : text("history.allergies");
  const chiefComplaint = text("symptoms.chiefComplaint");
  const impression = text("assessment.fieldImpression");
  const interventions = [
    ...textOrList("treatment.oxygen"),
    ...textOrList("treatment.medications"),
    ...textOrList("treatment.procedures"),
  ];
  const chestPain = text("symptoms.chestPain");
  const chestPainNrsRaw = fact("symptoms.chestPainNrs");
  const chestPainNrs = typeof chestPainNrsRaw === "number"
    ? chestPainNrsRaw
    : typeof chestPainNrsRaw === "string" && chestPainNrsRaw.trim() && Number.isFinite(Number(chestPainNrsRaw))
      ? Number(chestPainNrsRaw)
      : empty.pain.severityNrs;
  const chestPainQuality = text("symptoms.chestPainQuality") || chestPain;
  const chestPainRadiation = text("symptoms.chestPainRadiation");
  const primarySurvey = {
    airway: text("assessment.airway") || empty.primarySurvey.airway,
    breathing: text("assessment.breathing") || empty.primarySurvey.breathing,
    circulation: text("assessment.circulation") || empty.primarySurvey.circulation,
  };
  const reportedLocation = assignedRecord("reportedLocation");
  const reportedLatitude = typeof reportedLocation.latitude === "number" && Number.isFinite(reportedLocation.latitude)
    ? reportedLocation.latitude
    : assignedNumber("latitude");
  const reportedLongitude = typeof reportedLocation.longitude === "number" && Number.isFinite(reportedLocation.longitude)
    ? reportedLocation.longitude
    : assignedNumber("longitude");
  const latitude = reportedLatitude ?? previous.latitude;
  const longitude = reportedLongitude ?? previous.longitude;
  const hasCurrentPosition = latitude !== undefined && longitude !== undefined;
  const unitBase = assignedRecord("unitBase");
  const unitBaseLatitude = typeof unitBase.latitude === "number" && Number.isFinite(unitBase.latitude) ? unitBase.latitude : undefined;
  const unitBaseLongitude = typeof unitBase.longitude === "number" && Number.isFinite(unitBase.longitude) ? unitBase.longitude : undefined;
  const unitBaseName = typeof unitBase.name === "string" ? unitBase.name.trim() : "";
  const unitBaseAddress = typeof unitBase.address === "string" ? unitBase.address.trim() : "";
  const reportedAddress = assignedText("reportedAddress") || assignedText("location");
  const reportedPlaceName = assignedText("reportedPlaceName") || assignedText("locationShort");
  const estimatedAgeBand = assignedText("estimatedAgeBand");
  const estimatedSex = assignedText("estimatedSex");
  const estimatedPatient = [
    estimatedAgeBand ? `${estimatedAgeBand.replace(/\s*세(?:\s*추정)?$/u, "")}세 추정` : "",
    estimatedSex,
  ].filter(Boolean).join(" · ");
  const unresolvedItems = [
    ...(allergy ? [] : ["약물 알레르기"]),
    ...(text("assessment.ecg") ? [] : ["12유도 심전도 상세 소견"]),
  ];

  return {
    ...empty,
    id: snapshot.caseId,
    sourceCaseId: snapshot.caseId,
    unit: snapshot.meta?.unitId ?? (assignedText("unitId") || empty.unit),
    ...(unitBaseName && unitBaseAddress && unitBaseLatitude !== undefined && unitBaseLongitude !== undefined
      ? { unitBase: { name: unitBaseName, address: unitBaseAddress, latitude: unitBaseLatitude, longitude: unitBaseLongitude } }
      : {}),
    ...(reportedPlaceName ? { locationName: reportedPlaceName } : {}),
    ...(reportedAddress && reportedLatitude !== undefined && reportedLongitude !== undefined
      ? { sceneLocation: { name: reportedPlaceName || "신고 현장", address: reportedAddress, latitude: reportedLatitude, longitude: reportedLongitude } }
      : {}),
    location: reportedAddress || (hasCurrentPosition ? "현재 GPS 위치" : empty.location),
    locationShort: reportedPlaceName || (hasCurrentPosition ? "GPS 위치" : empty.locationShort),
    latitude,
    longitude,
    access: assignedText("access") || empty.access,
    caller: assignedText("caller") || empty.caller,
    callerPhone: assignedText("callerPhone") || empty.callerPhone,
    reportedPatient: assignedText("reportedPatient") || estimatedPatient || empty.reportedPatient,
    reportedComplaint: assignedText("reportedComplaint") || assignedText("dispatchSummary") || empty.reportedComplaint,
    patient,
    living: assignedText("baseline") || empty.living,
    chiefComplaint: chiefComplaint || empty.chiefComplaint,
    baseline: assignedText("baseline") || empty.baseline,
    onset,
    onsetSource: onsetRaw ? "확인된 사건 기록" : empty.onsetSource,
    symptoms,
    pain: {
      ...empty.pain,
      severityNrs: chestPainNrs,
      quality: chestPainQuality || empty.pain.quality,
      radiation: chestPainRadiation || empty.pain.radiation,
    },
    history: conditions,
    medication: medications.length ? `${medications.join(" · ")} · 확인됨` : empty.medication,
    allergy: allergy || empty.allergy,
    avpu: ["A", "V", "P", "U"].includes(text("consciousness.avpu"))
      ? text("consciousness.avpu") as ScenarioView["avpu"]
      : empty.avpu,
    primarySurvey,
    impression: impression || empty.impression,
    impressionStatus: impression ? "confirmed" : "unknown",
    interventions,
    unresolvedItems,
  };
}

export function snapshotToState(snapshot: OperationalCaseSnapshot): DemoState {
  const empty = operationalInitialState();
  const facts = snapshot.confirmedState.facts;
  const value = (path: string) => facts[path]?.value;
  const numberText = (path: string) => {
    const current = value(path);
    return typeof current === "number" || typeof current === "string" ? String(current) : "";
  };
  const systolic = numberText("vitals.systolicBp");
  const diastolic = numberText("vitals.diastolicBp");
  const vitals: VitalValues = {
    bp: systolic && diastolic ? `${systolic}/${diastolic}` : "",
    pr: numberText("vitals.pulse"),
    rr: numberText("vitals.respiratoryRate"),
    spo2: numberText("vitals.spo2"),
    temp: numberText("vitals.temperature"),
    glucose: numberText("vitals.glucose"),
  };
  const confirmedPaths = new Set(Object.entries(facts)
    .filter(([, confirmed]) => confirmed && hasUsableFactValue(confirmed.value))
    .map(([path]) => path));
  const completedSequences = completedAssessmentSequences(confirmedPaths);
  const confirmedPttIds = [
    ...completedSequences.map((sequence) => operationalPttUpdateId(snapshot.caseId, sequence)),
    confirmedPaths.has("transport.reassessment") ? operationalPttUpdateId(snapshot.caseId, 4) : null,
  ].filter((id) => id !== null) as string[];
  const confirmedFacts = Object.fromEntries(Object.entries(facts).flatMap(([path, confirmed]) => {
    if (!confirmed) return [];
    const displayValue = Array.isArray(confirmed.value) ? confirmed.value.join(" · ") : confirmed.value === null ? "미상" : String(confirmed.value);
    return [[path, {
      id: path,
      label: path,
      displayValue,
      status: "confirmed" as const,
      sourceLabel: "구급대원 확인",
      evidence: confirmed.sourceText,
      fieldPath: path,
      rawValue: confirmed.value,
      unit: confirmed.unit ?? null,
      confirmedAt: formatClock(confirmed.confirmedAt),
    } satisfies ConfirmedFact]];
  }));
  const events = snapshot.events?.length
    ? snapshot.events.map((event, index) => ({
        id: index + 1,
        time: formatClock(event.occurredAt),
        actor: backendActor(event.actorRole),
        title: backendEventTitle(event.type, event.payload),
        detail: typeof event.payload.detail === "string" ? event.payload.detail : event.summary,
        tone: event.type.includes("DECLINED") ? "red" as const : event.type.includes("REQUEST") ? "amber" as const : "teal" as const,
      }))
    : [];
  const latestRequest = snapshot.hospitalRequests?.[0];
  const stageByBackend: Record<NonNullable<OperationalCaseSnapshot["meta"]>["stage"], DemoStage> = {
    ASSIGNED: "assigned",
    DISPATCHING: "enroute",
    ON_SCENE: "scene-arrived",
    PATIENT_CONTACT: "patient-contact",
    ASSESSING: "assessing",
    HOSPITAL_REQUESTED: latestRequest?.status === "INFO_REQUESTED"
      ? "info-requested"
      : latestRequest?.status === "INFO_SENT"
        ? "info-sent"
        : latestRequest?.status === "ACCEPTED"
          ? "accepted"
          : latestRequest?.status === "DECLINED"
            ? "declined"
            : "hospital-requested",
    DESTINATION_CONFIRMED: "destination-confirmed",
    TRANSPORTING: "transporting",
    ARRIVED_HOSPITAL: "hospital-arrived",
    HANDOFF: "handoff-sent",
    COMPLETE: "complete",
  };
  const avpuValue = value("consciousness.avpu");
  const avpu = typeof avpuValue === "string" && ["A", "V", "P", "U"].includes(avpuValue)
    ? avpuValue as DemoState["avpu"]
    : "미확인";
  let resolvedStage = snapshot.meta?.stage ? stageByBackend[snapshot.meta.stage] : empty.stage;
  if (snapshot.meta?.stage === "ASSESSING" && completedSequences.length === 3) {
    resolvedStage = "summary-ready";
  }
  const reportStatus: ReportStatus = snapshot.report?.status === "FINALIZED"
    ? "closed"
    : snapshot.report?.status === "IN_REVIEW"
      ? "reviewed"
      : snapshot.report?.status === "DRAFT"
        ? "draft"
        : resolvedStage === "complete" ? "ready" : "locked";
  const reassessmentSystolic = numberText("reassessment.systolicBp");
  const reassessmentDiastolic = numberText("reassessment.diastolicBp");
  const reassessmentVitals: VitalValues | null = reassessmentSystolic && reassessmentDiastolic ? {
    bp: `${reassessmentSystolic}/${reassessmentDiastolic}`,
    pr: numberText("reassessment.pulse"),
    rr: numberText("reassessment.respiratoryRate"),
    spo2: numberText("reassessment.spo2"),
    temp: numberText("reassessment.temperature"),
    glucose: numberText("reassessment.glucose"),
  } : null;
  const reassessmentSummaryValue = value("transport.reassessment");
  const handoffEvent = [...(snapshot.events ?? [])].reverse().find((event) => event.type === "HANDOFF_ACCEPTED" || event.type === "HANDOFF_SENT");
  const handoffReceiver = typeof handoffEvent?.payload.receiver === "string" ? handoffEvent.payload.receiver : "";
  const handoffRole = typeof handoffEvent?.payload.role === "string" ? handoffEvent.payload.role : "";

  return {
    ...empty,
    stage: resolvedStage,
    vitals,
    vitalsConfirmed: completedSequences.includes(3),
    avpu,
    confirmedPttIds,
    confirmedFacts,
    voiceConfirmed: completedSequences.length === 3,
    cardioConfirmed: completedSequences.length === 3,
    selectedHospitalId: snapshot.meta?.destinationHospitalId ?? latestRequest?.hospitalId ?? null,
    activeHospitalRequestId: latestRequest?.requestId ?? null,
    declinedHospitalIds: snapshot.hospitalRequests?.filter((request) => request.status === "DECLINED").map((request) => request.hospitalId) ?? [],
    requestedInfo: latestRequest?.informationRequest?.message ? [latestRequest.informationRequest.message] : [],
    infoReply: latestRequest?.status === "INFO_SENT" ? "추가정보 회신 완료" : null,
    hospitalViewed: latestRequest ? latestRequest.status !== "REQUESTED" : false,
    destinationConfirmed: Boolean(snapshot.meta?.destinationHospitalId),
    reassessmentSaved: Boolean(reassessmentVitals),
    reassessmentVitals,
    reassessmentSummary: typeof reassessmentSummaryValue === "string" ? reassessmentSummaryValue : "미확인",
    handoffReceiver,
    handoffRole,
    reportStatus,
    reportReviewedIds: snapshot.report?.reviewedFields ?? [],
    events,
  };
}

export function hospitalRequestSnapshot(hospital: HospitalOption | undefined) {
  if (!hospital) return {};
  return {
    hospitalName: hospital.name,
    ...(typeof hospital.distanceKm === "number" ? { distanceKm: hospital.distanceKm } : {}),
    ...(hospital.etaMinutes === null || typeof hospital.etaMinutes === "number"
      ? { etaMinutes: hospital.etaMinutes }
      : {}),
  };
}

export function hospitalOptionsFromSnapshot(snapshot: OperationalCaseSnapshot): HospitalOption[] {
  const hospitalsById = new Map<string, HospitalOption>();
  for (const request of snapshot.hospitalRequests ?? []) {
    if (hospitalsById.has(request.hospitalId)) continue;
    hospitalsById.set(request.hospitalId, {
      id: request.hospitalId,
      name: request.hospitalName?.trim() || "병원명 미제공",
      type: "수용 문의 기관",
      distance: typeof request.distanceKm === "number" ? `${request.distanceKm.toFixed(1)} km` : "거리 미제공",
      eta: typeof request.etaMinutes === "number" ? `${request.etaMinutes}분` : "ETA 미제공",
      distanceKm: request.distanceKm ?? null,
      etaMinutes: request.etaMinutes ?? null,
      location: "기관 위치 미제공",
      reference: [],
    });
  }
  return [...hospitalsById.values()];
}

function commandForAction(action: Action, state: DemoState, hospitals: HospitalOption[]): { type: string; payload: Record<string, unknown> } | null {
  if (action.type === "TRANSITION") {
    const byStage: Partial<Record<DemoStage, string>> = {
      enroute: "DISPATCH_STARTED",
      "scene-arrived": "ARRIVED_SCENE",
      "patient-contact": "PATIENT_CONTACT",
      transporting: "TRANSPORT_STARTED",
      "hospital-arrived": "ARRIVED_HOSPITAL",
    };
    const type = byStage[action.stage];
    return type ? { type, payload: { title: action.title, detail: action.detail } } : null;
  }
  const requestId = state.activeHospitalRequestId;
  switch (action.type) {
    case "REQUEST_HOSPITAL": {
      const hospital = hospitals.find((item) => item.id === action.hospitalId);
      return {
        type: "HOSPITAL_REQUEST_CREATED",
        payload: {
          requestId: `REQ-${crypto.randomUUID()}`,
          hospitalId: action.hospitalId,
          ...hospitalRequestSnapshot(hospital),
        },
      };
    }
    case "MARK_HOSPITAL_VIEWED": return requestId ? { type: "HOSPITAL_REQUEST_VIEWED", payload: { requestId } } : null;
    case "REQUEST_INFO": return requestId ? { type: "ADDITIONAL_INFO_REQUESTED", payload: { requestId, message: action.fields.join(" · ") } } : null;
    case "ANSWER_INFO": return requestId ? { type: "ADDITIONAL_INFO_SENT", payload: { requestId, message: "구급대 재평가 및 요청정보 회신" } } : null;
    case "DECLINE": return requestId ? { type: "HOSPITAL_RESPONSE_RECORDED", payload: { requestId, decision: "DECLINED", reasonText: action.reason } } : null;
    case "ACCEPT": return requestId ? { type: "HOSPITAL_RESPONSE_RECORDED", payload: { requestId, decision: "ACCEPTED" } } : null;
    case "CONFIRM_DESTINATION": return requestId && state.selectedHospitalId ? { type: "DESTINATION_CONFIRMED_BY_PARAMEDIC", payload: { requestId, hospitalId: state.selectedHospitalId } } : null;
    case "SAVE_REASSESSMENT": return { type: "REASSESSMENT_CONFIRMED", payload: { values: action.values, symptomTrend: action.symptomTrend } };
    case "SET_HANDOFF": return { type: "HANDOFF_SENT", payload: { receiver: action.receiver, role: action.role } };
    case "RECEIVE_PATIENT": return requestId ? { type: "HANDOFF_ACCEPTED", payload: { requestId, receiver: action.receiver, role: action.role } } : null;
    default: return null;
  }
}

export function DemoProvider({
  children,
  operational = false,
  caseId = SCENARIO.sourceCaseId,
  operationalRole,
}: {
  children: ReactNode;
  operational?: boolean;
  caseId?: string;
  operationalRole?: OperationalRole;
}) {
  const [managed, managedDispatch] = useReducer(managedReducer, {
    value: operational ? operationalInitialState() : initialState(),
    origin: "initial",
    revision: 0,
  });
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hydratedRef = useRef(false);
  const realtimeRef = useRef<CaseRealtimeClient | null>(null);
  const [scenario, setScenario] = useState<ScenarioView>(() => operational ? createOperationalScenario(caseId) : SCENARIO);
  const [hospitals, setHospitals] = useState<HospitalOption[]>(() => operational ? [] : HOSPITALS);
  const [version, setVersion] = useState(0);
  const [confirmedVersion, setConfirmedVersion] = useState(0);
  const [remoteReport, setRemoteReport] = useState<OperationalReport | undefined>();
  const [connection, setConnection] = useState<DemoContextValue["sync"]["connection"]>(
    operational && OPERATIONAL_CONFIG.enabled ? "loading" : "local",
  );
  const [pending, setPending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [waitingForRequest, setWaitingForRequest] = useState(false);
  const state = managed.value;

  const remoteEnabled = operational && OPERATIONAL_CONFIG.enabled;
  const quietForbiddenAsWaiting = operationalRole === "hospital";

  const refresh = useCallback(async () => {
    if (!remoteEnabled) return;
    setConnection((current) => current === "connected" ? current : "loading");
    try {
      const snapshot = await getCaseSnapshot(caseId);
      setVersion(snapshot.meta?.version ?? snapshot.confirmedState.version);
      setConfirmedVersion(snapshot.confirmedState.version);
      setRemoteReport(snapshot.report);
      setScenario((current) => snapshotToScenario(snapshot, current));
      if (operationalRole !== "paramedic") setHospitals(hospitalOptionsFromSnapshot(snapshot));
      managedDispatch({ type: "SNAPSHOT", snapshot });
      setWaitingForRequest(false);
      setSyncError(null);
    } catch (error) {
      if (quietForbiddenAsWaiting && error instanceof EmsApiError && error.status === 403) {
        setConnection("disconnected");
        setWaitingForRequest(true);
        setSyncError(null);
        return;
      }
      setConnection("error");
      setWaitingForRequest(false);
      setSyncError(error instanceof Error ? error.message : "사건 정보를 불러오지 못했습니다.");
    }
  }, [caseId, operationalRole, quietForbiddenAsWaiting, remoteEnabled]);

  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    const normalized = { ...action, occurredAt: formatEventTime() } as Action;
    const directFactsRequest = action.type === "SAVE_REASSESSMENT" ? (() => {
      const values = action.values ?? state.reassessmentVitals ?? emptyVitals();
      const [systolic, diastolic] = values.bp.split("/").map((value) => Number(value.trim()));
      const observedAt = new Date().toISOString();
      const summary = action.symptomTrend?.trim() || "증상 변화 미상";
      return {
        expectedVersion: confirmedVersion,
        kind: "reassessment" as const,
        facts: [
          { path: "reassessment.systolicBp", value: systolic, observedAt, sourceText: `구급대원 직접 입력: 재평가 수축기혈압 ${systolic} mmHg` },
          { path: "reassessment.diastolicBp", value: diastolic, observedAt, sourceText: `구급대원 직접 입력: 재평가 이완기혈압 ${diastolic} mmHg` },
          { path: "reassessment.pulse", value: Number(values.pr), observedAt, sourceText: `구급대원 직접 입력: 재평가 맥박 ${values.pr}회/분` },
          { path: "reassessment.respiratoryRate", value: Number(values.rr), observedAt, sourceText: `구급대원 직접 입력: 재평가 호흡수 ${values.rr}회/분` },
          { path: "reassessment.spo2", value: Number(values.spo2), observedAt, sourceText: `구급대원 직접 입력: 재평가 SpO₂ ${values.spo2}%` },
          { path: "reassessment.temperature", value: Number(values.temp), observedAt, sourceText: `구급대원 직접 입력: 재평가 체온 ${values.temp}℃` },
          { path: "reassessment.glucose", value: Number(values.glucose), observedAt, sourceText: `구급대원 직접 입력: 재평가 혈당 ${values.glucose} mg/dL` },
          ...(state.avpu === "미확인" ? [] : [{ path: "reassessment.avpu", value: state.avpu, observedAt, sourceText: `구급대원 직접 확인: 재평가 AVPU ${state.avpu}` }]),
          { path: "transport.reassessment", value: summary, observedAt, sourceText: `구급대원 직접 확인: ${summary}` },
        ],
      };
    })() : null;
    if (remoteEnabled && directFactsRequest) {
      setPending(true);
      setSyncError(null);
      void confirmDirectFacts(caseId, directFactsRequest)
        .then((result) => {
          setConfirmedVersion(result.confirmedState.version);
          return refresh();
        })
        .catch((error: unknown) => setSyncError(error instanceof Error ? error.message : "직접 입력값을 저장하지 못했습니다."))
        .finally(() => setPending(false));
      return;
    }
    const reportRequest = action.type === "CREATE_REPORT"
      ? () => createReportDraft(caseId)
      : action.type === "MARK_REPORT_REVIEWED"
        ? () => reviewReport(caseId, action.reviewedFields?.length ? action.reviewedFields : OFFICIAL_REPORT_REVIEW_FIELDS)
        : action.type === "CLOSE_CASE"
          ? () => finalizeReport(caseId)
          : null;
    if (remoteEnabled && reportRequest) {
      setPending(true);
      setSyncError(null);
      void reportRequest()
        .then(() => refresh())
        .catch((error: unknown) => {
          setSyncError(error instanceof Error ? error.message : "보고서 상태를 반영하지 못했습니다.");
          if (OPERATIONAL_CONFIG.allowDevelopmentFallback) managedDispatch({ type: "LOCAL", action: normalized });
        })
        .finally(() => setPending(false));
      return;
    }
    const command = commandForAction(normalized, state, hospitals);
    if (!remoteEnabled || !command) {
      managedDispatch({ type: "LOCAL", action: normalized });
      return;
    }
    setPending(true);
    setSyncError(null);
    void submitCaseCommand(caseId, {
      commandId: crypto.randomUUID(),
      type: command.type,
      payload: command.payload,
      expectedVersion: version || undefined,
    }).then((response) => {
      setVersion(response.version);
      return refresh();
    }).catch((error: unknown) => {
      setSyncError(error instanceof Error ? error.message : "요청을 반영하지 못했습니다.");
      if (OPERATIONAL_CONFIG.allowDevelopmentFallback) managedDispatch({ type: "LOCAL", action: normalized });
    }).finally(() => setPending(false));
  }, [caseId, confirmedVersion, hospitals, refresh, remoteEnabled, state, version]);

  useEffect(() => {
    if (remoteEnabled) {
      const refreshTimer = window.setTimeout(() => void refresh(), 0);
      const realtime = new CaseRealtimeClient(caseId, {
        onMessage: (message) => {
          if (message.type === "case.invalidated") void refresh();
          if (message.type === "error") setSyncError(message.message);
        },
        onState: (nextConnection) => {
          setConnection(nextConnection);
          if (nextConnection === "connected") void refresh();
        },
        onError: (error) => {
          if (quietForbiddenAsWaiting && error instanceof EmsApiError && error.status === 403) {
            setWaitingForRequest(true);
            setSyncError(null);
            return;
          }
          setWaitingForRequest(false);
          setSyncError(error.message);
        },
      });
      realtimeRef.current = realtime;
      realtime.start();
      hydratedRef.current = true;
      return () => {
        window.clearTimeout(refreshTimer);
        realtime.stop();
        realtimeRef.current = null;
      };
    }
    if (operational) {
      hydratedRef.current = true;
      return;
    }
    const stored = readStoredState();
    if (stored) managedDispatch({ type: "REPLACE", state: stored, origin: "hydrate" });
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<DemoState>) => {
        if (event.data && Array.isArray(event.data.events)) managedDispatch({ type: "REPLACE", state: event.data, origin: "remote" });
      };
      channelRef.current = channel;
    }
    hydratedRef.current = true;
    return () => channelRef.current?.close();
  }, [caseId, operational, quietForbiddenAsWaiting, refresh, remoteEnabled]);

  useEffect(() => {
    if (!remoteEnabled || operationalRole !== "paramedic") return;
    const controller = new AbortController();
    let cancelled = false;
    const loadDirectory = async (latitude: number, longitude: number) => {
      try {
        const accessToken = await currentAccessToken();
        const { data } = await getHospitalDirectory({ caseId, latitude, longitude }, {
          signal: controller.signal,
          accessToken: accessToken ?? undefined,
        });
        if (cancelled) return;
        setHospitals(data.hospitals.map((hospital) => ({
          id: hospital.hospital_id,
          name: hospital.display_name,
          type: hospital.care_level,
          distance: `${hospital.distance_km.toFixed(1)} km`,
          eta: hospital.eta_minutes === null ? "ETA 미제공" : `${hospital.eta_minutes}분`,
          distanceKm: hospital.distance_km,
          etaMinutes: hospital.eta_minutes,
          location: hospital.region_label,
          reference: hospital.reference_capabilities,
          address: hospital.region_label,
          latitude: hospital.latitude,
          longitude: hospital.longitude,
          routeSource: hospital.route_source,
          routeIsLive: hospital.route_is_live,
          isRoadRoute: hospital.is_road_route,
        })));
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setSyncError("현장 기준 병원 기관정보와 경로를 불러오지 못했습니다. 연결 상태를 확인해 주세요.");
      }
    };

    // Hospital routing starts from the reported scene coordinate. This is the
    // ambulance's known operational origin while the patient is being assessed,
    // and it keeps a denied browser GPS permission from blocking the workflow.
    // Device GPS is requested only as a fallback when dispatch did not provide
    // a usable scene coordinate; it never overwrites the reported scene address.
    const sceneLatitude = scenario.sceneLocation?.latitude ?? scenario.latitude;
    const sceneLongitude = scenario.sceneLocation?.longitude ?? scenario.longitude;
    if (sceneLatitude !== undefined && sceneLongitude !== undefined) {
      void loadDirectory(sceneLatitude, sceneLongitude);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (!("geolocation" in navigator)) {
      const unavailableTimer = window.setTimeout(() => {
        setSyncError("신고 현장 좌표가 없고 현재 위치도 확인할 수 없습니다. 상황실에서 현장 위치를 확인해 주세요.");
      }, 0);
      return () => {
        window.clearTimeout(unavailableTimer);
        controller.abort();
      };
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        const { latitude, longitude } = position.coords;
        setScenario((current) => ({
          ...current,
          latitude,
          longitude,
        }));
      },
      () => {
        if (!cancelled) setSyncError("신고 현장 좌표가 없고 현재 위치 권한도 허용되지 않았습니다. 상황실에서 현장 위치를 확인해 주세요.");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    caseId,
    operationalRole,
    remoteEnabled,
    scenario.latitude,
    scenario.longitude,
    scenario.sceneLocation?.latitude,
    scenario.sceneLocation?.longitude,
  ]);

  useEffect(() => {
    if (operational || remoteEnabled || !hydratedRef.current || managed.origin !== "local") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* local demo may run with storage disabled */ }
    channelRef.current?.postMessage(state);
  }, [managed.origin, managed.revision, operational, remoteEnabled, state]);

  const selectedHospital = hospitals.find((item) => item.id === state.selectedHospitalId) ?? null;
  const progress = state.stage === "declined"
    ? FLOW_STAGES.indexOf("hospital-requested")
    : Math.max(0, FLOW_STAGES.indexOf(state.stage));

  const value = useMemo<DemoContextValue>(() => ({
    state,
    scenario,
    hospitals,
    dispatch,
    selectedHospital,
    progress,
    sync: {
      mode: remoteEnabled ? "remote" : operational ? "operational" : "demo",
      connection,
      pending,
      error: syncError,
      waitingForRequest,
      version,
      confirmedVersion,
      report: remoteReport,
      refresh,
    },
    reset: () => dispatch({ type: "RESET" }),
    transition: (stage, actor, title, detail, tone) => dispatch({ type: "TRANSITION", stage, actor, title, detail, tone }),
  }), [state, dispatch, scenario, hospitals, selectedHospital, progress, operational, remoteEnabled, connection, pending, syncError, waitingForRequest, refresh, version, confirmedVersion, remoteReport]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}

export function stageAtLeast(stage: DemoStage, target: DemoStage) {
  if (stage === "declined") return target === "coordination-requested" || target === "hospital-requested";
  return FLOW_STAGES.indexOf(stage) >= FLOW_STAGES.indexOf(target);
}

export { CARDIO_DEMO_HANDOFF, CARDIO_DEMO_PTT_UPDATES, CARDIO_DEMO_REPORT_DRAFT, CARDIO_DEMO_VITALS };
