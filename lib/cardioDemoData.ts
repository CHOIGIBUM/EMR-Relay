/**
 * Static UI fixture based on generated case GW-CARDIO-050.
 *
 * Source files used while authoring this module:
 * - generated/cases/GW-CARDIO-050/case.json
 * - generated/cases/GW-CARDIO-050/voice_updates.jsonl
 * - generated/cases/GW-CARDIO-050/hospital_events.jsonl
 *
 * The browser never reads those workspace files at runtime. Hospital names below
 * are fictional demo aliases and are not the names of real medical institutions.
 */

export type DemoSex = "female" | "male" | "unknown";
export type AvpuValue = "A" | "V" | "P" | "U";
export type FactReviewStatus =
  | "confirmed"
  | "unconfirmed"
  | "unknown"
  | "pending_review";

export type CardioCaseStage =
  | "ASSIGNED"
  | "EN_ROUTE"
  | "ON_SCENE"
  | "PATIENT_CONTACT"
  | "ASSESSING"
  | "ASSESSMENT_CONFIRMED"
  | "HOSPITAL_SEARCH"
  | "INQUIRY_SENT"
  | "INFO_REQUESTED"
  | "DECLINED"
  | "ACCEPTED"
  | "DESTINATION_CONFIRMED"
  | "TRANSPORTING"
  | "HOSPITAL_ARRIVED"
  | "HANDOFF_REVIEW"
  | "HANDOFF_COMPLETE"
  | "REPORT_DRAFT"
  | "REPORT_REVIEW"
  | "CLOSED";

export type CardioDispatch = {
  caseId: string;
  displayId: string;
  assignedUnit: string;
  callReceivedAt: string;
  dispatchAssignedAt: string;
  unitEnrouteAt: string;
  sceneArrivalAt: string;
  patientContactAt: string;
  transportDepartureAt: string;
  hospitalArrivalAt: string;
  handoffCompletedAt: string;
  callerRelation: string;
  reportedAgeBand: string;
  reportedSex: DemoSex;
  reportedComplaint: string;
  location: {
    sido: string;
    sigungu: string;
    setting: string;
    displayAddress: string;
    latitude: number;
    longitude: number;
  };
};

export type CardioPatient = {
  ageYears: number;
  ageBand: string;
  sex: DemoSex;
  sexLabel: string;
  baselineFunction: string;
  chiefComplaint: string;
  onsetAt: string;
  onsetPrecision: "exact" | "estimated" | "unknown";
  onsetContext: string;
  witnessed: boolean;
  symptoms: readonly string[];
  pain: {
    severityNrs: number;
    quality: string;
    region: string;
    radiation: string;
    provocation: string;
  };
  history: {
    conditions: readonly string[];
    medicationStatement: string;
    medicationName: string;
    medicationStatus: FactReviewStatus;
    allergyLabel: string;
    allergyStatus: FactReviewStatus;
  };
  initialAssessment: {
    avpu: AvpuValue;
    airway: string;
    breathing: string;
    circulation: string;
  };
  prehospitalImpressionCode: string;
  prehospitalImpressionLabel: string;
  impressionStatus: FactReviewStatus;
  unresolvedItems: readonly string[];
};

export type CardioVitalSet = {
  id: string;
  phase: "initial" | "reassessment";
  phaseLabel: string;
  measuredAt: string;
  bloodPressure: {
    systolic: number;
    diastolic: number;
    unit: "mmHg";
  };
  heartRate: { value: number; unit: "회/분"; rhythm: string };
  respiratoryRate: { value: number; unit: "회/분" };
  spo2: { value: number; unit: "%" };
  temperature: { value: number; unit: "℃" };
  bloodGlucose: { value: number; unit: "mg/dL" };
};

export type CardioPttProposal = {
  id: string;
  label: string;
  displayValue: string;
  status: FactReviewStatus;
  sourceLabel: string;
  evidence: string;
};

export type CardioPttUpdate = {
  id: string;
  sequence: 1 | 2 | 3 | 4;
  topic:
    | "initial_state"
    | "focused_history"
    | "vitals_ecg_intervention"
    | "reassessment_change";
  title: string;
  startedAt: string;
  endedAt: string;
  transcript: string;
  proposals: readonly CardioPttProposal[];
  needsReview: boolean;
};

export type HospitalDisplayStatus =
  | "unchecked"
  | "info_requested"
  | "declined"
  | "accepted"
  | "selected";

export type CardioHospitalCandidate = {
  id: string;
  alias: string;
  regionLabel: string;
  careLevelLabel: string;
  distanceKm: number;
  etaMinutes: number;
  displayOrder: 1 | 2 | 3;
  status: HospitalDisplayStatus;
  statusLabel: string;
  isDemoAlias: true;
  referenceCapabilities: readonly string[];
};

export type CardioHospitalEventType =
  | "inquiry_sent"
  | "inquiry_opened"
  | "info_requested"
  | "info_replied"
  | "declined"
  | "accepted"
  | "destination_selected";

export type CardioHospitalEvent = {
  id: string;
  attemptId: string;
  hospitalId: string;
  sequence: number;
  type: CardioHospitalEventType;
  actor: "paramedic" | "hospital_receiver";
  occurredAt: string;
  title: string;
  detail: string;
  requestedItems?: readonly string[];
  declineReasonCode?: string;
  arrivalInstruction?: string;
};

export type CardioInquiryBranch = {
  id: string;
  hospitalId: string;
  attemptId: string | null;
  outcome: "declined_after_more_info" | "accepted_and_selected" | "not_contacted";
  outcomeLabel: string;
  eventIds: readonly string[];
  nextAction: string;
};

export type CardioHandoff = {
  preparedAt: string;
  handedOffAt: string;
  receiverRole: string;
  destinationHospitalId: string;
  sections: {
    identification: string;
    medicalComplaint: string;
    information: string;
    signs: readonly string[];
    treatment: readonly string[];
    allergies: string;
    medication: string;
    background: string;
    otherInformation: string;
  };
  unresolvedItems: readonly string[];
};

export type CardioTimelinePoint = {
  id: string;
  stage: CardioCaseStage;
  occurredAt: string;
  label: string;
  actor: "dispatch" | "paramedic" | "hospital_receiver" | "system";
};

export type CardioReportDraft = {
  title: string;
  generatedAt: string;
  completion: {
    totalFields: number;
    autoFilledFields: number;
    reviewRequiredFields: number;
  };
  reviewItems: readonly {
    id: string;
    label: string;
    reason: string;
  }[];
};

export type CardioDemoFixture = {
  schemaVersion: string;
  isSynthetic: true;
  dispatch: CardioDispatch;
  patient: CardioPatient;
  vitalSets: readonly CardioVitalSet[];
  pttUpdates: readonly CardioPttUpdate[];
  hospitals: readonly CardioHospitalCandidate[];
  hospitalEvents: readonly CardioHospitalEvent[];
  inquiryBranches: readonly CardioInquiryBranch[];
  timeline: readonly CardioTimelinePoint[];
  handoff: CardioHandoff;
  reportDraft: CardioReportDraft;
};

export const CARDIO_DEMO_CASE_ID = "GW-CARDIO-050";

export const CARDIO_DEMO_DISPATCH = {
  caseId: CARDIO_DEMO_CASE_ID,
  displayId: "EMS-GW-050",
  assignedUnit: "강원 119 구급대 07",
  callReceivedAt: "2026-08-09T11:18:00+09:00",
  dispatchAssignedAt: "2026-08-09T11:19:00+09:00",
  unitEnrouteAt: "2026-08-09T11:22:00+09:00",
  sceneArrivalAt: "2026-08-09T11:53:00+09:00",
  patientContactAt: "2026-08-09T11:54:00+09:00",
  transportDepartureAt: "2026-08-09T12:36:17+09:00",
  hospitalArrivalAt: "2026-08-09T14:14:17+09:00",
  handoffCompletedAt: "2026-08-09T14:22:17+09:00",
  callerRelation: "목격자",
  reportedAgeBand: "65~74세 추정",
  reportedSex: "female",
  reportedComplaint: "쥐어짜는 양상의 흉통",
  location: {
    sido: "강원특별자치도",
    sigungu: "속초시",
    setting: "공공장소·차량·야외",
    displayAddress: "속초시 합성 현장 050",
    latitude: 38.219826,
    longitude: 128.11196,
  },
} as const satisfies CardioDispatch;

export const CARDIO_DEMO_PATIENT = {
  ageYears: 73,
  ageBand: "65~74세",
  sex: "female",
  sexLabel: "여성",
  baselineFunction: "독립보행",
  chiefComplaint: "쥐어짜는 양상의 흉통",
  onsetAt: "2026-08-09T09:38:00+09:00",
  onsetPrecision: "exact",
  onsetContext: "식사 후",
  witnessed: true,
  symptoms: ["흉통", "식은땀", "오심"],
  pain: {
    severityNrs: 5,
    quality: "무거운 느낌",
    region: "흉골 뒤 또는 가슴 중앙",
    radiation: "오른팔",
    provocation: "변화 없음",
  },
  history: {
    conditions: ["당뇨", "심부전"],
    medicationStatement: "항응고제 복용 중이라는 진술",
    medicationName: "와파린",
    medicationStatus: "unconfirmed",
    allergyLabel: "약물 알레르기 미상",
    allergyStatus: "unknown",
  },
  initialAssessment: {
    avpu: "A",
    airway: "기도 개방",
    breathing: "자발호흡",
    circulation: "맥박 촉지",
  },
  prehospitalImpressionCode: "suspected_acute_coronary_syndrome",
  prehospitalImpressionLabel: "급성관상동맥증후군 의심",
  impressionStatus: "pending_review",
  unresolvedItems: ["12유도 심전도 상세 소견", "약물 알레르기"],
} as const satisfies CardioPatient;

export const CARDIO_DEMO_VITALS = [
  {
    id: "VS01",
    phase: "initial",
    phaseLabel: "최초 측정",
    measuredAt: "2026-08-09T12:01:00+09:00",
    bloodPressure: { systolic: 163, diastolic: 90, unit: "mmHg" },
    heartRate: { value: 91, unit: "회/분", rhythm: "규칙" },
    respiratoryRate: { value: 23, unit: "회/분" },
    spo2: { value: 96, unit: "%" },
    temperature: { value: 37.4, unit: "℃" },
    bloodGlucose: { value: 116, unit: "mg/dL" },
  },
  {
    id: "VS02",
    phase: "reassessment",
    phaseLabel: "재평가",
    measuredAt: "2026-08-09T12:19:00+09:00",
    bloodPressure: { systolic: 148, diastolic: 86, unit: "mmHg" },
    heartRate: { value: 88, unit: "회/분", rhythm: "규칙" },
    respiratoryRate: { value: 21, unit: "회/분" },
    spo2: { value: 100, unit: "%" },
    temperature: { value: 37.4, unit: "℃" },
    bloodGlucose: { value: 116, unit: "mg/dL" },
  },
] as const satisfies readonly CardioVitalSet[];

export const CARDIO_DEMO_PTT_UPDATES = [
  {
    id: "GW-CARDIO-050-U01",
    sequence: 1,
    topic: "initial_state",
    title: "최초 환자 상태",
    startedAt: "2026-08-09T11:56:00+09:00",
    endedAt: "2026-08-09T11:56:22+09:00",
    transcript:
      "73세 여성 환자입니다. 주호소는 쥐어짜는 양상의 흉통입니다. 현재 의식은 AVPU A이고 목격자 진술과 함께 확인했습니다.",
    proposals: [
      {
        id: "U01-age",
        label: "연령·성별",
        displayValue: "73세 여성",
        status: "confirmed",
        sourceLabel: "구급대원 확인",
        evidence: "73세 여성 환자입니다.",
      },
      {
        id: "U01-complaint",
        label: "주호소",
        displayValue: "쥐어짜는 양상의 흉통",
        status: "confirmed",
        sourceLabel: "구급대원 관찰",
        evidence: "주호소는 쥐어짜는 양상의 흉통입니다.",
      },
      {
        id: "U01-avpu",
        label: "의식수준",
        displayValue: "AVPU A",
        status: "confirmed",
        sourceLabel: "구급대원 관찰",
        evidence: "현재 의식은 AVPU A",
      },
    ],
    needsReview: false,
  },
  {
    id: "GW-CARDIO-050-U02",
    sequence: 2,
    topic: "focused_history",
    title: "발생시각·과거력",
    startedAt: "2026-08-09T11:58:00+09:00",
    endedAt: "2026-08-09T11:58:19+09:00",
    transcript:
      "증상 시작 시각은 09시 38분이며 정확히 확인된 시각입니다. 과거력은 당뇨, 심부전입니다. 항응고제 복용 중으로 파악되며 약 이름은 와파린입니다. 약물 알레르기는 확인하지 못했습니다.",
    proposals: [
      {
        id: "U02-onset",
        label: "증상 발생시각",
        displayValue: "09:38",
        status: "confirmed",
        sourceLabel: "환자·보호자 진술",
        evidence: "증상 시작 시각은 09시 38분",
      },
      {
        id: "U02-history",
        label: "과거력",
        displayValue: "당뇨 · 심부전",
        status: "unconfirmed",
        sourceLabel: "환자·보호자 진술",
        evidence: "과거력은 당뇨, 심부전입니다.",
      },
      {
        id: "U02-medication",
        label: "복용약",
        displayValue: "와파린 복용 진술",
        status: "unconfirmed",
        sourceLabel: "환자·보호자 진술",
        evidence: "항응고제 복용 중으로 파악되며 약 이름은 와파린",
      },
      {
        id: "U02-allergy",
        label: "약물 알레르기",
        displayValue: "미상",
        status: "unknown",
        sourceLabel: "확인하지 못함",
        evidence: "약물 알레르기는 확인하지 못했습니다.",
      },
    ],
    needsReview: true,
  },
  {
    id: "GW-CARDIO-050-U03",
    sequence: 3,
    topic: "vitals_ecg_intervention",
    title: "활력징후·처치",
    startedAt: "2026-08-09T12:05:00+09:00",
    endedAt: "2026-08-09T12:05:14+09:00",
    transcript:
      "최초 활력징후는 혈압 163/90 mmHg, 맥박 91회/분, 호흡 23회/분, 산소포화도 96%, 체온 37.4도, 혈당 116 mg/dL입니다. 12유도 심전도 상세 소견은 현재 확인하지 못했습니다. 심전도 감시, 12유도 심전도, 정맥로 확보를 시행했습니다.",
    proposals: [
      {
        id: "U03-vitals",
        label: "최초 활력징후",
        displayValue: "BP 163/90 · PR 91 · RR 23 · SpO₂ 96%",
        status: "confirmed",
        sourceLabel: "측정값",
        evidence: "최초 활력징후는 혈압 163/90 mmHg",
      },
      {
        id: "U03-ecg",
        label: "12유도 심전도 상세 소견",
        displayValue: "미상",
        status: "unknown",
        sourceLabel: "구급대원 확인 필요",
        evidence: "상세 소견은 현재 확인하지 못했습니다.",
      },
      {
        id: "U03-treatment",
        label: "시행 처치",
        displayValue: "심전도 감시 · 12유도 심전도 · 정맥로 확보",
        status: "confirmed",
        sourceLabel: "구급대 기록",
        evidence: "심전도 감시, 12유도 심전도, 정맥로 확보를 시행",
      },
    ],
    needsReview: true,
  },
  {
    id: "GW-CARDIO-050-U04",
    sequence: 4,
    topic: "reassessment_change",
    title: "이송 전 재평가",
    startedAt: "2026-08-09T12:20:00+09:00",
    endedAt: "2026-08-09T12:20:17+09:00",
    transcript:
      "재평가 결과 증상이 일부 호전되고 활력징후가 안정되는 양상입니다. 혈압 148/86 mmHg, 맥박 88회/분, 호흡 21회/분, 산소포화도 100%, 체온 37.4도, 혈당 116 mg/dL입니다. 병원 전 판단은 급성관상동맥증후군 의심이며 확정 진단은 아닙니다.",
    proposals: [
      {
        id: "U04-vitals",
        label: "재평가 활력징후",
        displayValue: "BP 148/86 · PR 88 · RR 21 · SpO₂ 100%",
        status: "confirmed",
        sourceLabel: "측정값",
        evidence: "혈압 148/86 mmHg, 맥박 88회/분",
      },
      {
        id: "U04-outcome",
        label: "재평가 결과",
        displayValue: "증상 일부 호전, 활력징후 안정 양상",
        status: "confirmed",
        sourceLabel: "구급대원 재평가",
        evidence: "증상이 일부 호전되고 활력징후가 안정되는 양상",
      },
      {
        id: "U04-impression",
        label: "병원 전 평가",
        displayValue: "급성관상동맥증후군 의심",
        status: "pending_review",
        sourceLabel: "구급대원 판단",
        evidence: "확정 진단은 아닙니다.",
      },
    ],
    needsReview: true,
  },
] as const satisfies readonly CardioPttUpdate[];

export const CARDIO_DEMO_HOSPITALS = [
  {
    id: "H-GW-EMG-020",
    alias: "해솔응급의료센터",
    regionLabel: "속초권",
    careLevelLabel: "지역응급의료센터",
    distanceKm: 26.2,
    etaMinutes: 46,
    displayOrder: 1,
    status: "declined",
    statusLabel: "수용 곤란",
    isDemoAlias: true,
    referenceCapabilities: ["응급의학과", "CT", "심전도"],
  },
  {
    id: "H-GW-EMG-016",
    alias: "푸른강권역응급센터",
    regionLabel: "영동권",
    careLevelLabel: "권역응급의료센터",
    distanceKm: 59.1,
    etaMinutes: 98,
    displayOrder: 2,
    status: "selected",
    statusLabel: "수용 확인 · 이송지",
    isDemoAlias: true,
    referenceCapabilities: ["응급의학과", "심장내과", "심혈관조영실"],
  },
  {
    id: "H-GW-EMG-012",
    alias: "새봄종합병원",
    regionLabel: "강원권",
    careLevelLabel: "지역응급의료기관",
    distanceKm: 64.5,
    etaMinutes: 107,
    displayOrder: 3,
    status: "unchecked",
    statusLabel: "문의 전",
    isDemoAlias: true,
    referenceCapabilities: ["응급실", "CT"],
  },
] as const satisfies readonly CardioHospitalCandidate[];

export const CARDIO_DEMO_HOSPITAL_EVENTS = [
  {
    id: "GW-CARDIO-050-HE01",
    attemptId: "GW-CARDIO-050-A01",
    hospitalId: "H-GW-EMG-020",
    sequence: 1,
    type: "inquiry_sent",
    actor: "paramedic",
    occurredAt: "2026-08-09T12:22:17+09:00",
    title: "수용 문의 전송",
    detail: "확정 환자정보와 ETA 46분을 전송했습니다.",
  },
  {
    id: "GW-CARDIO-050-HE02",
    attemptId: "GW-CARDIO-050-A01",
    hospitalId: "H-GW-EMG-020",
    sequence: 2,
    type: "inquiry_opened",
    actor: "hospital_receiver",
    occurredAt: "2026-08-09T12:23:17+09:00",
    title: "병원 확인",
    detail: "병원 수용 담당자가 요청을 열었습니다.",
  },
  {
    id: "GW-CARDIO-050-HE03",
    attemptId: "GW-CARDIO-050-A01",
    hospitalId: "H-GW-EMG-020",
    sequence: 3,
    type: "info_requested",
    actor: "hospital_receiver",
    occurredAt: "2026-08-09T12:24:17+09:00",
    title: "추가정보 요청",
    detail: "재평가 활력징후와 복용약 확인을 요청했습니다.",
    requestedItems: ["재평가 활력징후", "12유도 심전도 상세 소견", "항혈소판제·항응고제 복용"],
  },
  {
    id: "GW-CARDIO-050-HE04",
    attemptId: "GW-CARDIO-050-A01",
    hospitalId: "H-GW-EMG-020",
    sequence: 4,
    type: "info_replied",
    actor: "paramedic",
    occurredAt: "2026-08-09T12:26:17+09:00",
    title: "추가정보 회신",
    detail: "재평가값은 확정, 심전도 상세 소견은 미상, 와파린 복용은 진술 기반으로 회신했습니다.",
  },
  {
    id: "GW-CARDIO-050-HE05",
    attemptId: "GW-CARDIO-050-A01",
    hospitalId: "H-GW-EMG-020",
    sequence: 5,
    type: "declined",
    actor: "hospital_receiver",
    occurredAt: "2026-08-09T12:28:17+09:00",
    title: "수용 곤란",
    detail: "관련 진료과 대응이 어렵다는 회신입니다.",
    declineReasonCode: "relevant_department_unavailable",
  },
  {
    id: "GW-CARDIO-050-HE06",
    attemptId: "GW-CARDIO-050-A02",
    hospitalId: "H-GW-EMG-016",
    sequence: 6,
    type: "inquiry_sent",
    actor: "paramedic",
    occurredAt: "2026-08-09T12:29:17+09:00",
    title: "두 번째 수용 문의",
    detail: "확정 환자정보와 ETA 98분을 전송했습니다.",
  },
  {
    id: "GW-CARDIO-050-HE07",
    attemptId: "GW-CARDIO-050-A02",
    hospitalId: "H-GW-EMG-016",
    sequence: 7,
    type: "inquiry_opened",
    actor: "hospital_receiver",
    occurredAt: "2026-08-09T12:30:17+09:00",
    title: "병원 확인",
    detail: "병원 수용 담당자가 요청을 열었습니다.",
  },
  {
    id: "GW-CARDIO-050-HE08",
    attemptId: "GW-CARDIO-050-A02",
    hospitalId: "H-GW-EMG-016",
    sequence: 8,
    type: "accepted",
    actor: "hospital_receiver",
    occurredAt: "2026-08-09T12:31:17+09:00",
    title: "수용 가능",
    detail: "병원이 수용 가능을 회신했습니다.",
    arrivalInstruction: "구급차 출입구 도착 후 해당 팀 호출",
  },
  {
    id: "GW-CARDIO-050-HE09",
    attemptId: "GW-CARDIO-050-A02",
    hospitalId: "H-GW-EMG-016",
    sequence: 9,
    type: "destination_selected",
    actor: "paramedic",
    occurredAt: "2026-08-09T12:32:17+09:00",
    title: "이송지 확정",
    detail: "구급대원이 수용 회신을 확인하고 최종 이송지로 선택했습니다.",
  },
] as const satisfies readonly CardioHospitalEvent[];

export const CARDIO_DEMO_INQUIRY_BRANCHES = [
  {
    id: "branch-first-hospital",
    hospitalId: "H-GW-EMG-020",
    attemptId: "GW-CARDIO-050-A01",
    outcome: "declined_after_more_info",
    outcomeLabel: "추가정보 회신 후 수용 곤란",
    eventIds: [
      "GW-CARDIO-050-HE01",
      "GW-CARDIO-050-HE02",
      "GW-CARDIO-050-HE03",
      "GW-CARDIO-050-HE04",
      "GW-CARDIO-050-HE05",
    ],
    nextAction: "다음 병원 선택",
  },
  {
    id: "branch-second-hospital",
    hospitalId: "H-GW-EMG-016",
    attemptId: "GW-CARDIO-050-A02",
    outcome: "accepted_and_selected",
    outcomeLabel: "수용 가능 회신 후 이송지 확정",
    eventIds: ["GW-CARDIO-050-HE06", "GW-CARDIO-050-HE07", "GW-CARDIO-050-HE08", "GW-CARDIO-050-HE09"],
    nextAction: "병원 길안내 시작",
  },
  {
    id: "branch-third-hospital",
    hospitalId: "H-GW-EMG-012",
    attemptId: null,
    outcome: "not_contacted",
    outcomeLabel: "문의하지 않음",
    eventIds: [],
    nextAction: "필요 시 문의 가능",
  },
] as const satisfies readonly CardioInquiryBranch[];

export const CARDIO_DEMO_HANDOFF = {
  preparedAt: "2026-08-09T14:20:17+09:00",
  handedOffAt: "2026-08-09T14:22:17+09:00",
  receiverRole: "응급실 의료진",
  destinationHospitalId: "H-GW-EMG-016",
  sections: {
    identification: "73세 여성, 현장 확인",
    medicalComplaint: "09:38부터 발생한 쥐어짜는 흉통, 식은땀과 오심 동반",
    information: "통증 NRS 5, 흉골 뒤 또는 가슴 중앙, 오른팔 방사",
    signs: [
      "최초 12:01 — BP 163/90 mmHg, PR 91회/분, RR 23회/분, SpO₂ 96%",
      "재평가 12:19 — BP 148/86 mmHg, PR 88회/분, RR 21회/분, SpO₂ 100%",
      "의식수준 AVPU A, 증상 일부 호전",
    ],
    treatment: ["심전도 감시", "12유도 심전도 시행", "정맥로 확보"],
    allergies: "약물 알레르기 미상",
    medication: "와파린 복용 진술 — 약제 확인 필요",
    background: "과거력 당뇨·심부전 — 환자 또는 보호자 진술",
    otherInformation: "급성관상동맥증후군 의심은 병원 전 평가이며 확정 진단이 아님",
  },
  unresolvedItems: ["12유도 심전도 상세 소견", "약물 알레르기"],
} as const satisfies CardioHandoff;

export const CARDIO_DEMO_TIMELINE = [
  { id: "T01", stage: "ASSIGNED", occurredAt: "2026-08-09T11:19:00+09:00", label: "출동 지령", actor: "dispatch" },
  { id: "T02", stage: "EN_ROUTE", occurredAt: "2026-08-09T11:22:00+09:00", label: "출동 시작", actor: "paramedic" },
  { id: "T03", stage: "ON_SCENE", occurredAt: "2026-08-09T11:53:00+09:00", label: "현장 도착", actor: "paramedic" },
  { id: "T04", stage: "PATIENT_CONTACT", occurredAt: "2026-08-09T11:54:00+09:00", label: "환자 접촉", actor: "paramedic" },
  { id: "T05", stage: "ASSESSMENT_CONFIRMED", occurredAt: "2026-08-09T12:20:17+09:00", label: "현장평가 확인", actor: "paramedic" },
  { id: "T06", stage: "INQUIRY_SENT", occurredAt: "2026-08-09T12:22:17+09:00", label: "첫 병원 수용 문의", actor: "paramedic" },
  { id: "T07", stage: "INFO_REQUESTED", occurredAt: "2026-08-09T12:24:17+09:00", label: "추가정보 요청", actor: "hospital_receiver" },
  { id: "T08", stage: "DECLINED", occurredAt: "2026-08-09T12:28:17+09:00", label: "첫 병원 수용 곤란", actor: "hospital_receiver" },
  { id: "T09", stage: "ACCEPTED", occurredAt: "2026-08-09T12:31:17+09:00", label: "두 번째 병원 수용 가능", actor: "hospital_receiver" },
  { id: "T10", stage: "DESTINATION_CONFIRMED", occurredAt: "2026-08-09T12:32:17+09:00", label: "이송지 확정", actor: "paramedic" },
  { id: "T11", stage: "TRANSPORTING", occurredAt: "2026-08-09T12:36:17+09:00", label: "이송 시작", actor: "paramedic" },
  { id: "T12", stage: "HOSPITAL_ARRIVED", occurredAt: "2026-08-09T14:14:17+09:00", label: "병원 도착", actor: "paramedic" },
  { id: "T13", stage: "HANDOFF_COMPLETE", occurredAt: "2026-08-09T14:22:17+09:00", label: "환자 인계 완료", actor: "hospital_receiver" },
] as const satisfies readonly CardioTimelinePoint[];

export const CARDIO_DEMO_REPORT_DRAFT = {
  title: "구급활동일지 대응 작성 초안",
  generatedAt: "2026-08-09T14:22:18+09:00",
  completion: {
    totalFields: 38,
    autoFilledFields: 34,
    reviewRequiredFields: 4,
  },
  reviewItems: [
    { id: "R01", label: "병원 전 평가소견", reason: "구급대원 판단의 최종 확인이 필요합니다." },
    { id: "R02", label: "와파린 복용", reason: "진술 기반 정보로 약제 확인이 필요합니다." },
    { id: "R03", label: "약물 알레르기", reason: "확인되지 않아 미상으로 기록되어 있습니다." },
    { id: "R04", label: "병원 인수자", reason: "인수자 이름과 서명은 현장에서 입력해야 합니다." },
  ],
} as const satisfies CardioReportDraft;

export const CARDIO_DEMO_FIXTURE = {
  schemaVersion: "1.0.0",
  isSynthetic: true,
  dispatch: CARDIO_DEMO_DISPATCH,
  patient: CARDIO_DEMO_PATIENT,
  vitalSets: CARDIO_DEMO_VITALS,
  pttUpdates: CARDIO_DEMO_PTT_UPDATES,
  hospitals: CARDIO_DEMO_HOSPITALS,
  hospitalEvents: CARDIO_DEMO_HOSPITAL_EVENTS,
  inquiryBranches: CARDIO_DEMO_INQUIRY_BRANCHES,
  timeline: CARDIO_DEMO_TIMELINE,
  handoff: CARDIO_DEMO_HANDOFF,
  reportDraft: CARDIO_DEMO_REPORT_DRAFT,
} as const satisfies CardioDemoFixture;
