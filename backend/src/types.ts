export const ALLOWED_FACT_PATHS = [
  "patient.age",
  "patient.sex",
  "symptoms.chiefComplaint",
  "symptoms.onsetAt",
  "symptoms.chestPain",
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
  "assessment.ecg",
  "assessment.fieldImpression",
  "treatment.oxygen",
  "treatment.medications",
  "treatment.procedures",
  "transport.reassessment",
] as const;

export type FactPath = (typeof ALLOWED_FACT_PATHS)[number];
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
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };
