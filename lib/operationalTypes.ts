export type OperationalRole = "paramedic" | "control" | "hospital" | "admin";

export type OperationalStage =
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

export type BackendCaseStage =
  | "ASSIGNED"
  | "DISPATCHING"
  | "ON_SCENE"
  | "PATIENT_CONTACT"
  | "ASSESSING"
  | "HOSPITAL_REQUESTED"
  | "DESTINATION_CONFIRMED"
  | "TRANSPORTING"
  | "ARRIVED_HOSPITAL"
  | "HANDOFF"
  | "COMPLETE";

export type OperationalVitalValues = {
  bp: string;
  pr: string;
  rr: string;
  spo2: string;
  temp: string;
  glucose: string;
};

export type OperationalScenario = {
  id: string;
  sourceCaseId: string;
  unit: string;
  location: string;
  locationShort: string;
  latitude?: number;
  longitude?: number;
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
  pain: {
    severityNrs: number | "미확인";
    quality: string;
    region: string;
    radiation: string;
    provocation: string;
  };
  history: string[];
  medication: string;
  allergy: string;
  avpu: "미확인" | "A" | "V" | "P" | "U";
  impression: string;
  impressionStatus: "confirmed" | "unconfirmed" | "unknown" | "pending_review";
  interventions: string[];
  unresolvedItems: string[];
};

export type OperationalHospital = {
  id: string;
  name: string;
  type: string;
  distance: string;
  eta: string;
  location: string;
  reference: string[];
  latitude?: number;
  longitude?: number;
  referenceAt?: string;
};

export type OperationalTimelineEvent = {
  id: number;
  time: string;
  actor: "119 상황실" | "구급대원" | "이송조정 상황실" | "병원" | "시스템";
  title: string;
  detail: string;
  tone?: "neutral" | "teal" | "amber" | "red";
};

export type OperationalCaseState = {
  stage: OperationalStage;
  vitals: OperationalVitalValues;
  vitalsConfirmed: boolean;
  avpu: "미확인" | "A" | "V" | "P" | "U";
  cardioConfirmed: boolean;
  voiceConfirmed: boolean;
  confirmedPttIds: string[];
  confirmedFacts: Record<string, unknown>;
  rejectedProposalIds: string[];
  selectedHospitalId: string | null;
  declinedHospitalIds: string[];
  requestedInfo: string[];
  infoReply: string | null;
  hospitalViewed: boolean;
  destinationConfirmed: boolean;
  reassessmentSaved: boolean;
  reassessmentVitals: OperationalVitalValues | null;
  reassessmentSummary: string;
  handoffReceiver: string;
  handoffRole: string;
  reportStatus: "locked" | "ready" | "draft" | "reviewed" | "closed";
  reportReviewedIds: string[];
  events: OperationalTimelineEvent[];
};

export type OperationalConfirmedFact = {
  value: string | number | boolean | null | string[];
  unit?: string;
  observedAt?: string;
  sourceText: string;
  confirmedAt: string;
  confirmedBy: string;
  proposalId: string;
};

export type OperationalAnnex5Draft = {
  schema: "KR_AMBULANCE_ACTIVITY_ANNEX5_MVP_V1";
  generatedAt: string;
  administrative: Record<string, unknown>;
  dispatchTimeline: Record<string, unknown>;
  patientIdentity: Record<string, unknown>;
  symptomsAndOccurrence: Record<string, unknown>;
  patientAssessment: {
    consciousness: Record<string, unknown>;
    pupils: Record<string, unknown>;
    vitalSigns: Array<Record<string, unknown>>;
    severityLevel: Record<string, unknown>;
  };
  paramedicAssessment: Record<string, unknown>;
  emergencyCare: Record<string, unknown>;
  medicalDirection: Record<string, unknown>;
  transport: Record<string, unknown>;
  handoff: Record<string, unknown>;
  mutualAidAndNonTransport: Record<string, unknown>;
  crewAndBarriers: Record<string, unknown>;
  missingFields: string[];
};

export type OperationalReport = {
  reportId: string;
  version: number;
  status: "DRAFT" | "IN_REVIEW" | "FINALIZED";
  draft: OperationalAnnex5Draft;
  reviewedFields: string[];
  finalizedAt?: string;
  finalizedBy?: string;
};

/** Authoritative read model returned by GET /cases/{id}. */
export type OperationalCaseSnapshot = {
  caseId: string;
  confirmedState: {
    caseId: string;
    version: number;
    facts: Record<string, OperationalConfirmedFact | undefined>;
    createdAt?: string;
    updatedAt?: string;
  };
  proposals: unknown[];
  audit: unknown[];
  meta?: {
    caseId: string;
    version: number;
    stage: BackendCaseStage;
    scenario?: string;
    agency?: string;
    unitId?: string;
    vehicleNumber?: string;
    assignedParamedicIds: string[];
    destinationHospitalId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  events?: Array<{
    eventId: string;
    type: string;
    actorSub: string;
    actorRole: OperationalRole;
    occurredAt: string;
    version: number;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  hospitalRequests?: Array<{
    requestId: string;
    hospitalId: string;
    hospitalName?: string;
    status: "REQUESTED" | "VIEWED" | "INFO_REQUESTED" | "INFO_SENT" | "ACCEPTED" | "DECLINED" | "CANCELLED";
    requestedBy: string;
    createdAt: string;
    updatedAt: string;
    response?: {
      decision: "ACCEPTED" | "DECLINED";
      reasonCode?: string;
      reasonText?: string;
      respondedBy: string;
      respondedAt: string;
    };
    informationRequest?: { message: string; requestedBy: string; requestedAt: string };
  }>;
  report?: OperationalReport;
};

export type CaseCommandRequest = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  expectedVersion?: number;
};

export type CaseCommandResponse = {
  caseId: string;
  version: number;
  eventId: string;
  eventType: string;
  occurredAt: string;
};

export type TranscribeSessionRequest = {
  caseId: string;
  languageCode?: "ko-KR";
  sampleRateHertz?: 16000;
};

export type TranscribeSessionResponse = {
  sessionId: string;
  websocketUrl: string;
  expiresAt: string;
  languageCode: "ko-KR";
  mediaEncoding: "pcm";
  sampleRateHertz: 16000;
};

export type RealtimeSessionResponse = {
  websocketUrl: string;
  ticket: string;
  expiresAt: string;
};

export type CaseRealtimeMessage =
  | { type: "case.invalidated"; caseId: string; version: number; eventType: string; occurredAt: string }
  | { type: "heartbeat"; occurredAt: string }
  | { type: "error"; code: string; message: string };
