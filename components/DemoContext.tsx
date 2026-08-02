"use client";

import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";

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

export type CpssValues = {
  face: "미확인" | "정상" | "좌측" | "우측" | "평가 불가";
  arm: "미확인" | "정상" | "좌측" | "우측" | "평가 불가";
  speech: "미확인" | "정상" | "어눌함" | "표현 곤란" | "평가 불가";
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

export const SCENARIO = {
  id: "EMS-GW-001",
  reportTime: "14:20",
  dispatchTime: "14:21",
  location: "홍천군 북방면 굴지리 125",
  locationShort: "홍천군 북방면",
  access: "단독주택 · 마당 안쪽 출입문",
  caller: "이웃 주민",
  callerPhone: "010-42**-11**",
  reportedPatient: "70대 추정 여성",
  reportedComplaint: "말이 어눌하고 오른팔에 힘이 없음",
  patient: "78세 여성",
  living: "독거 · 자녀 타 지역 거주",
  chiefComplaint: "갑작스러운 구음장애 · 우측 얼굴 및 팔 위약",
  baseline: "평소 독립보행 · 대화 정상",
  lnt: "13:40",
  lntSource: "자녀와 정상 통화",
  fat: "14:15",
  fatSource: "이웃이 최초 발견",
  history: ["고혈압", "당뇨"],
  medication: "항응고제 복용 여부 미상",
  allergy: "미상",
  avpu: "A",
  preKtas: "2",
} as const;

export const HOSPITALS: HospitalOption[] = [
  {
    id: "hallym",
    name: "한림대학교춘천성심병원",
    type: "응급의료기관",
    distance: "36.8 km",
    eta: "35분",
    location: "춘천시 삭주로 77",
    reference: ["기관정보", "CT", "신경과"],
  },
  {
    id: "knuh",
    name: "강원대학교병원",
    type: "응급의료기관",
    distance: "39.2 km",
    eta: "38분",
    location: "춘천시 백령로 156",
    reference: ["기관정보", "CT", "신경과"],
  },
  {
    id: "hongcheon",
    name: "홍천아산병원",
    type: "응급의료기관",
    distance: "11.4 km",
    eta: "16분",
    location: "홍천군 산림공원1길 17",
    reference: ["기관정보", "가까운 순"],
  },
];

export const STAGE_LABEL: Record<DemoStage, string> = {
  assigned: "출동 배정",
  enroute: "출동 중",
  "scene-arrived": "현장 도착",
  "patient-contact": "환자 접촉",
  assessing: "현장평가 중",
  "summary-ready": "평가 완료",
  "coordination-requested": "병원 조정 요청",
  "hospital-requested": "병원 회신 대기",
  "info-requested": "추가정보 요청",
  "info-sent": "추가정보 회신",
  declined: "수용 곤란",
  accepted: "수용 가능",
  "destination-confirmed": "이송지 확인",
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
  cpss: CpssValues;
  strokeConfirmed: boolean;
  voiceConfirmed: boolean;
  selectedHospitalId: string | null;
  declinedHospitalIds: string[];
  requestedInfo: string[];
  infoReply: string | null;
  hospitalViewed: boolean;
  destinationConfirmed: boolean;
  reassessmentSaved: boolean;
  handoffReceiver: string;
  handoffRole: string;
  events: DemoEvent[];
};

const initialEvents: DemoEvent[] = [
  {
    id: 1,
    time: "14:20",
    actor: "119 상황실",
    title: "119 신고 접수",
    detail: "이웃 신고 · 말이 어눌하고 오른팔에 힘이 없음",
  },
  {
    id: 2,
    time: "14:21",
    actor: "119 상황실",
    title: "구급대 출동 지령",
    detail: "홍천소방서 구급1대 배정",
    tone: "teal",
  },
];

export const initialDemoState: DemoState = {
  stage: "assigned",
  vitals: { bp: "", pr: "", rr: "", spo2: "", temp: "", glucose: "" },
  vitalsConfirmed: false,
  avpu: "미확인",
  cpss: { face: "미확인", arm: "미확인", speech: "미확인" },
  strokeConfirmed: false,
  voiceConfirmed: false,
  selectedHospitalId: null,
  declinedHospitalIds: [],
  requestedInfo: [],
  infoReply: null,
  hospitalViewed: false,
  destinationConfirmed: false,
  reassessmentSaved: false,
  handoffReceiver: "",
  handoffRole: "간호사",
  events: initialEvents,
};

type Action =
  | { type: "RESET" }
  | { type: "TRANSITION"; stage: DemoStage; time: string; actor: Actor; title: string; detail: string; tone?: EventTone }
  | { type: "LOAD_VITALS" }
  | { type: "SET_VITAL"; key: keyof VitalValues; value: string }
  | { type: "SET_AVPU"; value: DemoState["avpu"] }
  | { type: "SET_CPSS"; key: keyof CpssValues; value: CpssValues[keyof CpssValues] }
  | { type: "CONFIRM_VOICE" }
  | { type: "CONFIRM_ASSESSMENT" }
  | { type: "REQUEST_COORDINATION" }
  | { type: "REQUEST_HOSPITAL"; hospitalId: string }
  | { type: "MARK_HOSPITAL_VIEWED" }
  | { type: "REQUEST_INFO"; fields: string[] }
  | { type: "ANSWER_INFO" }
  | { type: "DECLINE"; reason: string }
  | { type: "ACCEPT" }
  | { type: "CONFIRM_DESTINATION" }
  | { type: "SAVE_REASSESSMENT" }
  | { type: "SET_HANDOFF"; receiver: string; role: string }
  | { type: "RECEIVE_PATIENT"; receiver: string; role: string };

function appendEvent(
  state: DemoState,
  event: Omit<DemoEvent, "id">,
): DemoState {
  return {
    ...state,
    events: [...state.events, { ...event, id: state.events.length + 1 }],
  };
}

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "RESET":
      return { ...initialDemoState, events: initialEvents.map((event) => ({ ...event })) };
    case "TRANSITION":
      return appendEvent(
        { ...state, stage: action.stage },
        { time: action.time, actor: action.actor, title: action.title, detail: action.detail, tone: action.tone },
      );
    case "LOAD_VITALS":
      return appendEvent(
        {
          ...state,
          stage: "assessing",
          vitals: { bp: "178/96", pr: "92", rr: "18", spo2: "97", temp: "36.7", glucose: "118" },
          vitalsConfirmed: true,
          avpu: "A",
        },
        {
          time: "14:29",
          actor: "구급대원",
          title: "최초 활력징후 확인",
          detail: "BP 178/96 mmHg · PR 92회/분 · SpO₂ 97% · BST 118 mg/dL",
          tone: "teal",
        },
      );
    case "SET_VITAL":
      return { ...state, vitals: { ...state.vitals, [action.key]: action.value } };
    case "SET_AVPU":
      return { ...state, avpu: action.value };
    case "SET_CPSS":
      return { ...state, cpss: { ...state.cpss, [action.key]: action.value } as CpssValues };
    case "CONFIRM_VOICE":
      return appendEvent(
        {
          ...state,
          stage: "assessing",
          voiceConfirmed: true,
          strokeConfirmed: true,
          cpss: { face: "우측", arm: "우측", speech: "어눌함" },
        },
        {
          time: "14:30",
          actor: "구급대원",
          title: "뇌졸중 선별정보 확인",
          detail: "우측 얼굴·팔 위약, 구음장애 · LNT 13:40 · FAT 14:15",
          tone: "amber",
        },
      );
    case "CONFIRM_ASSESSMENT":
      return appendEvent(
        { ...state, stage: "summary-ready", strokeConfirmed: true },
        {
          time: "14:32",
          actor: "구급대원",
          title: "환자 확인본 생성",
          detail: "급성 뇌졸중 의심 · Pre-KTAS 2 · 미상 항목 포함",
          tone: "teal",
        },
      );
    case "REQUEST_COORDINATION":
      return appendEvent(
        { ...state, stage: "coordination-requested" },
        {
          time: "14:33",
          actor: "구급대원",
          title: "병원 조정 요청",
          detail: "이송조정 상황실에 구급대원 확인본 전달",
          tone: "amber",
        },
      );
    case "REQUEST_HOSPITAL": {
      const hospital = HOSPITALS.find((item) => item.id === action.hospitalId) ?? HOSPITALS[0];
      return appendEvent(
        { ...state, stage: "hospital-requested", selectedHospitalId: action.hospitalId, requestedInfo: [], infoReply: null, hospitalViewed: false },
        {
          time: state.declinedHospitalIds.length ? "14:37" : "14:34",
          actor: "이송조정 상황실",
          title: "병원 수용 확인 요청",
          detail: `${hospital.name} · 활성 요청 1건`,
          tone: "amber",
        },
      );
    }
    case "MARK_HOSPITAL_VIEWED":
      if (state.hospitalViewed) return state;
      return appendEvent(
        { ...state, hospitalViewed: true },
        {
          time: "14:34",
          actor: "병원",
          title: "수용 요청 열람",
          detail: "병원 담당자가 구급대원 환자 확인본을 열람",
        },
      );
    case "REQUEST_INFO":
      return appendEvent(
        { ...state, stage: "info-requested", requestedInfo: action.fields },
        {
          time: "14:35",
          actor: "병원",
          title: "추가정보 요청",
          detail: action.fields.join(" · "),
          tone: "amber",
        },
      );
    case "ANSWER_INFO":
      return appendEvent(
        { ...state, stage: "info-sent", infoReply: "항응고제 복용 여부와 마지막 복용시각 미상" },
        {
          time: "14:36",
          actor: "구급대원",
          title: "추가정보 회신",
          detail: "항응고제 복용 여부와 마지막 복용시각 미상",
          tone: "teal",
        },
      );
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
          time: "14:38",
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
          time: "14:38",
          actor: "병원",
          title: "수용 가능 회신",
          detail: `${hospital?.name ?? "요청 병원"} · 응급실 구급차 출입구`,
          tone: "teal",
        },
      );
    }
    case "CONFIRM_DESTINATION":
      return appendEvent(
        { ...state, stage: "destination-confirmed", destinationConfirmed: true },
        {
          time: "14:39",
          actor: "구급대원",
          title: "이송지 확인",
          detail: HOSPITALS.find((item) => item.id === state.selectedHospitalId)?.name ?? "수용 병원",
          tone: "teal",
        },
      );
    case "SAVE_REASSESSMENT":
      return appendEvent(
        { ...state, reassessmentSaved: true },
        {
          time: "14:52",
          actor: "구급대원",
          title: "이송 중 재평가",
          detail: "AVPU A · BP 180/98 mmHg · SpO₂ 97% · 증상 지속",
        },
      );
    case "SET_HANDOFF":
      return appendEvent(
        { ...state, stage: "handoff-sent", handoffReceiver: action.receiver, handoffRole: action.role },
        {
          time: "15:05",
          actor: "구급대원",
          title: "구두·전자 인계 완료",
          detail: "병원 의료진 인수 확인 대기",
          tone: "teal",
        },
      );
    case "RECEIVE_PATIENT":
      return appendEvent(
        { ...state, stage: "complete", handoffReceiver: action.receiver, handoffRole: action.role },
        {
          time: "15:06",
          actor: "병원",
          title: "환자 인수 확인",
          detail: `${action.role} ${action.receiver || "담당자"} · 사건 종료`,
          tone: "teal",
        },
      );
    default:
      return state;
  }
}

type DemoContextValue = {
  state: DemoState;
  selectedHospital: HospitalOption | null;
  progress: number;
  dispatch: React.Dispatch<Action>;
  reset: () => void;
  transition: (stage: DemoStage, time: string, actor: Actor, title: string, detail: string, tone?: EventTone) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialDemoState);
  const selectedHospital = HOSPITALS.find((item) => item.id === state.selectedHospitalId) ?? null;
  const progress = state.stage === "declined"
    ? FLOW_STAGES.indexOf("hospital-requested")
    : Math.max(0, FLOW_STAGES.indexOf(state.stage));

  const value = useMemo<DemoContextValue>(
    () => ({
      state,
      dispatch,
      selectedHospital,
      progress,
      reset: () => dispatch({ type: "RESET" }),
      transition: (stage, time, actor, title, detail, tone) =>
        dispatch({ type: "TRANSITION", stage, time, actor, title, detail, tone }),
    }),
    [state, selectedHospital, progress],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}

export function stageAtLeast(stage: DemoStage, target: DemoStage) {
  const stageIndex = FLOW_STAGES.indexOf(stage);
  const targetIndex = FLOW_STAGES.indexOf(target);
  if (stage === "declined") return target === "coordination-requested" || target === "hospital-requested";
  return stageIndex >= targetIndex;
}
