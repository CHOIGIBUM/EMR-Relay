export type V2Role = "paramedic" | "hospital";

export type V2RealtimeStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type V2RealtimeScope =
  | { role: "paramedic"; caseIds: string[] }
  | { role: "hospital"; hospitalId: string };

export type V2CaseUpdate = {
  caseId: string;
  version: number;
  eventId: string;
  eventType: string;
  stage: string;
  occurredAt: string;
  requestId?: string;
  hospitalId?: string;
  requestStatus?: string;
  payload?: unknown;
};

export type CaseStage =
  | "assigned"
  | "enroute"
  | "scene-arrived"
  | "patient-contact"
  | "assessing"
  | "card-confirmed"
  | "matching"
  | "destination-selected"
  | "transporting"
  | "arrived";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type Sex = "female" | "male" | "unknown";
export type Avpu = "A" | "V" | "P" | "U";
export type StrokeSide = "normal" | "left" | "right" | "unassessable";
export type SpeechFinding = "normal" | "dysarthria" | "aphasia" | "unassessable";

export type PatientAssessment = {
  age?: number;
  sex?: Sex;
  airway?: "patent" | "at-risk" | "obstructed";
  breathing?: "adequate" | "labored" | "inadequate";
  circulation?: "stable" | "poor-perfusion" | "arrest";
  avpu?: Avpu;
  chiefComplaint?: string;
  face?: StrokeSide;
  arm?: StrokeSide;
  speech?: SpeechFinding;
  systolicBp?: number;
  diastolicBp?: number;
  pulse?: number;
  respiratoryRate?: number;
  spo2?: number;
  glucose?: number;
  temperature?: number;
  lastKnownWell?: string;
  lastKnownWellBasis?: string;
  firstAbnormalTime?: string;
  measuredAt?: string;
  voiceNote?: string;
};

export type VoiceUpdateFocus = "BASIC" | "CPSS" | "VITALS";

export type TranscribeSession = {
  sessionId: string;
  websocketUrl: string;
  expiresAt: string;
  languageCode: "ko-KR";
  mediaEncoding: "pcm";
  sampleRateHertz: 16000;
};

export type VoiceProposalChange = {
  changeId: string;
  path: string;
  value: string | number | boolean | null | string[];
  unit?: string;
  observedAt?: string;
  certainty: "clear" | "needs_confirmation" | "unknown";
  sourceText: string;
  note?: string;
};

export type VoiceProposalFlag = {
  code: string;
  severity: "info" | "warning" | "critical";
  field?: string;
  message: string;
};

export type VoiceProposal = {
  proposalId: string;
  caseId: string;
  baseVersion: number;
  status: "PENDING";
  summary: string;
  changes: VoiceProposalChange[];
  flags: VoiceProposalFlag[];
  createdAt: string;
  requiresHumanReview: true;
};

export type ConfirmedPatientCard = PatientAssessment & {
  cpss: number;
  confirmedAt: string;
  confirmedBy: "paramedic";
};

export type DispatchCase = {
  id: string;
  code: string;
  stage: CaseStage;
  reportTime: string;
  reportSummary: string;
  reportDetail: string;
  estimatedAge: string;
  estimatedSex: string;
  reporter: string;
  dispatchUnit: string;
  station: string;
  sceneAddress: string;
  scene: Coordinate;
  assessment: PatientAssessment;
  patientCard: ConfirmedPatientCard | null;
  destinationRequestId: string | null;
  timeline: Partial<Record<"dispatchStartedAt" | "sceneArrivedAt" | "patientContactAt" | "cardConfirmedAt" | "transportStartedAt" | "hospitalArrivedAt", string>>;
  version: number;
  hospitalRequests?: HospitalRequest[];
};

export type Hospital = {
  id: string;
  name: string;
  address: string;
  location: Coordinate;
  capabilities: string[];
};

export type HospitalRouteReference = {
  caseId: string;
  hospitalId: string;
  wave: number;
  distanceKm: number;
  etaMinutes: number;
  path?: Coordinate[];
};

export type HospitalRequestStatus = "REQUESTED" | "VIEWED" | "ACCEPTED" | "DECLINED" | "CLOSED";

export type HospitalRequest = {
  id: string;
  caseId: string;
  hospitalId: string;
  hospitalName?: string;
  hospitalAddress?: string;
  hospitalLocation?: Coordinate;
  wave: number;
  radiusKm?: number;
  status: HospitalRequestStatus;
  distanceKm: number;
  etaMinutes: number;
  requestedAt: string;
  viewedAt?: string;
  respondedAt?: string;
  reason?: string;
};

export type V2Store = {
  cases: DispatchCase[];
  hospitals: Hospital[];
  routes: HospitalRouteReference[];
  requests: HospitalRequest[];
  updatedAt: string;
};

export type HospitalInboxItem = {
  request: HospitalRequest;
  incident: DispatchCase;
  hospital: Hospital;
};

export type HospitalDecision = "ACCEPTED" | "DECLINED";

export function cpssScore(assessment: PatientAssessment) {
  return Number(Boolean(assessment.face && assessment.face !== "normal" && assessment.face !== "unassessable"))
    + Number(Boolean(assessment.arm && assessment.arm !== "normal" && assessment.arm !== "unassessable"))
    + Number(Boolean(assessment.speech && assessment.speech !== "normal" && assessment.speech !== "unassessable"));
}

export const REQUIRED_ASSESSMENT_FIELDS: Array<keyof PatientAssessment> = [
  "age",
  "sex",
  "airway",
  "breathing",
  "circulation",
  "avpu",
  "chiefComplaint",
  "face",
  "arm",
  "speech",
  "systolicBp",
  "diastolicBp",
  "pulse",
  "respiratoryRate",
  "spo2",
  "glucose",
  "lastKnownWell",
  "lastKnownWellBasis",
  "firstAbnormalTime",
  "measuredAt",
];

export function assessmentComplete(assessment: PatientAssessment) {
  return REQUIRED_ASSESSMENT_FIELDS.every((field) => {
    const value = assessment[field];
    return value !== undefined && value !== null && value !== "";
  });
}
