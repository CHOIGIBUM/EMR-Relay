"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
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
  location: string;
  reference: string[];
};

const formatClock = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(iso));

export const SCENARIO = {
  id: CARDIO_DEMO_DISPATCH.displayId,
  sourceCaseId: CARDIO_DEMO_DISPATCH.caseId,
  unit: CARDIO_DEMO_DISPATCH.assignedUnit,
  location: CARDIO_DEMO_DISPATCH.location.displayAddress,
  locationShort: CARDIO_DEMO_DISPATCH.location.sigungu,
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
  impression: CARDIO_DEMO_PATIENT.prehospitalImpressionLabel,
  impressionStatus: CARDIO_DEMO_PATIENT.impressionStatus,
  interventions: ["심전도 감시", "12유도 심전도", "정맥로 확보"],
  unresolvedItems: [...CARDIO_DEMO_PATIENT.unresolvedItems],
} as const;

export const HOSPITALS: HospitalOption[] = CARDIO_DEMO_HOSPITALS.map((hospital) => ({
  id: hospital.id,
  name: hospital.alias,
  type: hospital.careLevelLabel,
  distance: `${hospital.distanceKm.toFixed(1)} km`,
  eta: `${hospital.etaMinutes}분`,
  location: hospital.regionLabel,
  reference: [...hospital.referenceCapabilities],
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

const STORAGE_KEY = "ems-relay:cardio-mvp-state:v5";
const CHANNEL_NAME = "ems-relay:cardio-mvp-state:v5";

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
  | { type: "MARK_REPORT_REVIEWED" }
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
  if (!update || state.confirmedPttIds.includes(update.id)) return state;

  const proposals: readonly CardioPttProposal[] = reviewedProposals ?? update.proposals;
  const accepted = proposals.filter((proposal) => acceptedProposalIds.includes(proposal.id));
  const facts = { ...state.confirmedFacts };
  for (const proposal of accepted) {
    facts[proposal.id] = {
      ...proposal,
      status: proposal.status === "pending_review" ? "confirmed" : proposal.status,
      confirmedAt: occurredAt,
    };
  }

  const confirmedPttIds = [...state.confirmedPttIds, update.id];
  const firstThreeConfirmed = CARDIO_DEMO_PTT_UPDATES.slice(0, 3).every((item) => confirmedPttIds.includes(item.id));
  const isInitialVitals = update.topic === "vitals_ecg_intervention"
    && accepted.some((item) => item.fieldPath?.startsWith("vitals.") || item.id === "U03-vitals");
  const isReassessment = update.topic === "reassessment_change"
    && accepted.some((item) => item.fieldPath?.startsWith("vitals.") || item.id === "U04-vitals");
  const initialVitals = isInitialVitals ? applyVitalProposals(state.vitals, accepted) : state.vitals;
  const reassessmentVitals = isReassessment
    ? applyVitalProposals(state.reassessmentVitals ?? emptyVitals(), accepted)
    : state.reassessmentVitals;
  const avpuProposal = accepted.find((item) => item.fieldPath === "assessment.avpu" || item.id === "U01-avpu");
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
    vitalsConfirmed: hasCompleteVitalSet(initialVitals) || state.vitalsConfirmed,
    avpu: nextAvpu,
    reassessmentSaved: (isReassessment && reassessmentVitals !== null && hasCompleteVitalSet(reassessmentVitals)) || state.reassessmentSaved,
    reassessmentVitals,
    reassessmentSummary: isReassessment ? "흉통 및 식은땀 일부 호전" : state.reassessmentSummary,
  };

  next = appendEvent(next, {
    time: occurredAt,
    actor: "구급대원",
    title: `${update.title} 확인`,
    detail: `제안 ${accepted.length}건 반영${rejectedProposalIds.length ? ` · ${rejectedProposalIds.length}건 제외` : ""}`,
    tone: update.needsReview ? "amber" : "teal",
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
      if (!state.vitalsConfirmed || state.avpu === "미확인" || state.confirmedPttIds.length < 3) return state;
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
          detail: `${hospital?.name ?? "요청 병원"} · 구급차 출입구 도착 후 해당 팀 호출`,
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
  | { type: "REPLACE"; state: DemoState; origin: "hydrate" | "remote" };

function managedReducer(state: ManagedState, action: ManagedAction): ManagedState {
  if (action.type === "REPLACE") return { value: action.state, origin: action.origin, revision: state.revision + 1 };
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
  selectedHospital: HospitalOption | null;
  progress: number;
  dispatch: React.Dispatch<Action>;
  reset: () => void;
  transition: (stage: DemoStage, actor: Actor, title: string, detail: string, tone?: EventTone) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [managed, managedDispatch] = useReducer(managedReducer, {
    value: initialState(),
    origin: "initial",
    revision: 0,
  });
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hydratedRef = useRef(false);
  const state = managed.value;

  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    managedDispatch({ type: "LOCAL", action: { ...action, occurredAt: formatEventTime() } as Action });
  }, []);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || managed.origin !== "local") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* local demo may run with storage disabled */ }
    channelRef.current?.postMessage(state);
  }, [managed.origin, managed.revision, state]);

  const selectedHospital = HOSPITALS.find((item) => item.id === state.selectedHospitalId) ?? null;
  const progress = state.stage === "declined"
    ? FLOW_STAGES.indexOf("hospital-requested")
    : Math.max(0, FLOW_STAGES.indexOf(state.stage));

  const value = useMemo<DemoContextValue>(() => ({
    state,
    dispatch,
    selectedHospital,
    progress,
    reset: () => dispatch({ type: "RESET" }),
    transition: (stage, actor, title, detail, tone) => dispatch({ type: "TRANSITION", stage, actor, title, detail, tone }),
  }), [state, dispatch, selectedHospital, progress]);

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
