export const ALLOWED_FACT_PATHS = [
  "patient.age",
  "patient.sex",
  "symptoms.chiefComplaint",
  "symptoms.onsetAt",
  "symptoms.chestPain",
  "symptoms.chestPainNrs",
  "symptoms.chestPainQuality",
  "symptoms.chestPainRadiation",
  "symptoms.associated",
  "consciousness.avpu",
  "vitals.systolicBp",
  "vitals.diastolicBp",
  "vitals.pulse",
  "vitals.respiratoryRate",
  "vitals.spo2",
  "vitals.temperature",
  "vitals.glucose",
  "history.conditions",
  "history.medications",
  "history.allergies",
  "assessment.airway",
  "assessment.breathing",
  "assessment.circulation",
  "assessment.ecg",
  "assessment.fieldImpression",
  "treatment.oxygen",
  "treatment.medications",
  "treatment.procedures",
  "reassessment.systolicBp",
  "reassessment.diastolicBp",
  "reassessment.pulse",
  "reassessment.respiratoryRate",
  "reassessment.spo2",
  "reassessment.temperature",
  "reassessment.glucose",
  "reassessment.avpu",
  "transport.reassessment",
] as const;

export type FactPath = (typeof ALLOWED_FACT_PATHS)[number];

/**
 * Minimum human-confirmed dataset used by the three mobile assessment steps.
 * Optional history, medication, allergy, ECG and treatment fields are not
 * workflow gates; missing optional facts remain explicitly unknown.
 */
export const INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP = {
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
} as const satisfies Record<1 | 2 | 3, readonly FactPath[]>;

export const INITIAL_ASSESSMENT_REQUIRED_PATHS: readonly FactPath[] = [
  ...INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP[1],
  ...INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP[2],
  ...INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP[3],
];
export type ProposalValue = string | number | boolean | null | string[];
export type ProposalCertainty = "clear" | "needs_confirmation" | "unknown";
export type FlagSeverity = "info" | "warning" | "critical";

export type ProposedChangeInput = {
  path: FactPath;
  value: ProposalValue;
  unit?: string;
  observedAt?: string;
  certainty: ProposalCertainty;
  sourceText: string;
  note?: string;
};

export type ProposedChange = ProposedChangeInput & {
  changeId: string;
};

export type ProposalFlag = {
  code: string;
  severity: FlagSeverity;
  field?: FactPath;
  message: string;
};

export type AgentModelOutput = {
  schemaVersion: "1.0";
  summary: string;
  changes: ProposedChangeInput[];
  flags: ProposalFlag[];
};

export type AgentProposal = {
  proposalId: string;
  caseId: string;
  status: "PENDING" | "CONFIRMED";
  baseVersion: number;
  schemaVersion: "1.0";
  summary: string;
  changes: ProposedChange[];
  flags: ProposalFlag[];
  transcriptHash: string;
  source: "ptt" | "manual" | "asr_test";
  requestedBy: string;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
};

export type ConfirmedFact = {
  value: ProposalValue;
  unit?: string;
  observedAt?: string;
  sourceText: string;
  confirmedAt: string;
  confirmedBy: string;
  proposalId: string;
};

export type ConfirmedState = {
  caseId: string;
  version: number;
  facts: Partial<Record<FactPath, ConfirmedFact>>;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentRequest = {
  caseId: string;
  transcript: string;
  observedAt?: string;
  source: "ptt" | "manual" | "asr_test";
  requestedBy: string;
  updateId?: string;
  phase?: "dispatch" | "scene" | "transport" | "reassessment" | "handoff";
};

export type ConfirmDecision = {
  changeId: string;
  action: "accept" | "reject";
  value?: ProposalValue;
};

export type ConfirmRequest = {
  proposalId: string;
  expectedVersion: number;
  reviewedBy: string;
  decisions: ConfirmDecision[];
};

export type DirectFactInput = {
  path: FactPath;
  value: ProposalValue;
  observedAt?: string;
  sourceText: string;
};

export type DirectFactsRequest = {
  expectedVersion: number;
  kind: "initial" | "reassessment";
  facts: DirectFactInput[];
};

export type AuditEvent = {
  auditId: string;
  caseId: string;
  action: "PROPOSAL_CREATED" | "PROPOSAL_CONFIRMED";
  actor: string;
  occurredAt: string;
  proposalId: string;
  fromVersion: number;
  toVersion: number;
  acceptedPaths?: FactPath[];
  rejectedPaths?: FactPath[];
};

export type CaseView = {
  caseId: string;
  confirmedState: ConfirmedState;
  proposals: AgentProposal[];
  audit: AuditEvent[];
  meta?: CaseMeta;
  events?: CaseEvent[];
  hospitalRequests?: HospitalRequest[];
  report?: AmbulanceActivityReport;
};

export const PRINCIPAL_ROLES = ["paramedic", "control", "hospital", "admin"] as const;
export type PrincipalRole = (typeof PRINCIPAL_ROLES)[number];

export type AuthPrincipal = {
  sub: string;
  username?: string;
  hospitalId?: string;
  roles: PrincipalRole[];
};

export const CASE_STAGES = [
  "ASSIGNED",
  "DISPATCHING",
  "ON_SCENE",
  "PATIENT_CONTACT",
  "ASSESSING",
  "HOSPITAL_REQUESTED",
  "DESTINATION_CONFIRMED",
  "TRANSPORTING",
  "ARRIVED_HOSPITAL",
  "HANDOFF",
  "COMPLETE",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_EVENT_TYPES = [
  "CASE_ASSIGNED",
  "DISPATCH_STARTED",
  "ARRIVED_SCENE",
  "PATIENT_CONTACT",
  "PATIENT_FACTS_CONFIRMED",
  "HOSPITAL_REQUEST_CREATED",
  "HOSPITAL_REQUEST_VIEWED",
  "ADDITIONAL_INFO_REQUESTED",
  "ADDITIONAL_INFO_SENT",
  "HOSPITAL_RESPONSE_RECORDED",
  "DESTINATION_CONFIRMED_BY_PARAMEDIC",
  "TRANSPORT_STARTED",
  "REASSESSMENT_CONFIRMED",
  "ARRIVED_HOSPITAL",
  "HANDOFF_SENT",
  "HANDOFF_ACCEPTED",
  "REPORT_DRAFTED",
  "REPORT_REVIEWED",
  "REPORT_FINALIZED",
  "FHIR_PUBLISHED",
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

export type CaseMeta = {
  caseId: string;
  version: number;
  stage: CaseStage;
  scenario?: string;
  agency?: string;
  unitId?: string;
  vehicleNumber?: string;
  assignedParamedicIds: string[];
  destinationHospitalId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseEvent = {
  eventId: string;
  caseId: string;
  type: CaseEventType;
  actorSub: string;
  actorRole: PrincipalRole;
  occurredAt: string;
  version: number;
  summary: string;
  payload: Record<string, unknown>;
};

export type HospitalRequestStatus =
  | "REQUESTED"
  | "VIEWED"
  | "INFO_REQUESTED"
  | "INFO_SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "CANCELLED";

export type HospitalResponse = {
  decision: "ACCEPTED" | "DECLINED";
  reasonCode?: string;
  reasonText?: string;
  respondedBy: string;
  respondedAt: string;
};

export type HospitalInformationRequest = {
  message: string;
  requestedBy: string;
  requestedAt: string;
};

export type HospitalRequest = {
  requestId: string;
  caseId: string;
  hospitalId: string;
  hospitalName?: string;
  distanceKm?: number;
  etaMinutes?: number | null;
  status: HospitalRequestStatus;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  response?: HospitalResponse;
  informationRequest?: HospitalInformationRequest;
};

export type CaseCommand = {
  commandId: string;
  type: CaseEventType;
  expectedVersion?: number;
  payload: Record<string, unknown>;
};

export type CommandResult = {
  caseId: string;
  version: number;
  eventId: string;
  eventType: CaseEventType;
  occurredAt: string;
};

export type ReportStatus = "DRAFT" | "IN_REVIEW" | "FINALIZED";

export type Annex5ReportDraft = {
  schema: "KR_AMBULANCE_ACTIVITY_ANNEX5_MVP_V1";
  generatedAt: string;
  administrative: {
    organization?: string;
    vehicleNumber?: string;
    documentNumber?: string;
    approvals: Record<string, unknown>;
  };
  dispatchTimeline: {
    caseId: string;
    reportedAt?: string;
    dispatchStartedAt?: string;
    arrivedSceneAt?: string;
    patientContactAt?: string;
    transportStartedAt?: string;
    arrivedHospitalAt?: string;
    handoffAcceptedAt?: string;
  };
  patientIdentity: Record<string, unknown>;
  symptomsAndOccurrence: Record<string, unknown>;
  patientAssessment: {
    primarySurvey?: Record<string, unknown>;
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

export type AmbulanceActivityReport = {
  reportId: string;
  caseId: string;
  version: number;
  status: ReportStatus;
  draft: Annex5ReportDraft;
  reviewedFields: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  finalizedAt?: string;
  finalizedBy?: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };
