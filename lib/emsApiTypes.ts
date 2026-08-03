export type VoiceFactStatus = "proposed" | "unconfirmed" | "unknown";
export type VoiceReviewState = "pending_review";

export type VoiceProposalSource = {
  kind:
    | "paramedic_observation"
    | "patient_or_caregiver_statement"
    | "device_measurement"
    | "team_record"
    | "paramedic_impression"
    | "speech_transcript";
  evidence: string;
  observed_at: string | null;
};

export type VoiceProposedUpdate = {
  proposal_id: string;
  field_path: string;
  display_label: string;
  display_value: string;
  value: unknown;
  unit: string | null;
  fact_status: VoiceFactStatus;
  review_state: VoiceReviewState;
  source: VoiceProposalSource;
};

export type VoiceProposalWarning = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  field_paths: string[];
};

export type VoiceReviewSummary = {
  total_count: number;
  confirmable_count: number;
  attention_count: number;
  unknown_count: number;
  message: string;
};

/**
 * Contract returned by the extraction/validation workflow.
 * `pending_review` must remain true: this endpoint can propose facts but cannot
 * write the confirmed clinical state.
 */
export type VoiceProposalResponse = {
  request_id: string;
  case_id: string;
  update_id: string;
  transcript: string;
  pending_review: true;
  proposed_updates: VoiceProposedUpdate[];
  warnings: VoiceProposalWarning[];
  review_summary: VoiceReviewSummary;
  processed_at: string;
  proposal_set_id: string | null;
  base_version: number | null;
};

export type CreateVoiceProposalRequest = {
  caseId: string;
  updateId: string;
  transcript: string;
  locale?: string;
  clientEventId?: string;
};

export type HospitalDirectoryItem = {
  hospital_id: string;
  display_name: string;
  care_level: string;
  region_label: string;
  distance_km: number;
  eta_minutes: number | null;
  reference_capabilities: string[];
  latitude?: number;
  longitude?: number;
  route_source: "kakao_mobility_live" | "kakao_mobility_snapshot" | "local_straight_line_estimate" | "unavailable";
  route_is_live: boolean;
  is_road_route: boolean;
  reference_source?: string;
};

export type HospitalDirectoryResponse = {
  hospitals: HospitalDirectoryItem[];
  reference_at: string;
  source: "live_reference_apis" | "unavailable" | "public_reference_api" | "local_fixture";
};

export type HospitalDirectoryRequest = {
  caseId: string;
  latitude: number;
  longitude: number;
};

export type RouteReferenceRequest = {
  caseId: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
};

export type RouteReferenceResponse = {
  distance_km: number | null;
  eta_minutes: number | null;
  source: "kakao_mobility_live" | "kakao_mobility_snapshot" | "local_straight_line_estimate" | "unavailable";
  is_live: boolean;
  is_road_route: boolean;
  calculated_at: string;
  notice: string;
  path?: Array<{ latitude: number; longitude: number }>;
};

export type EmsApiTransport = "remote" | "local";

export type EmsApiResult<T> = {
  data: T;
  transport: EmsApiTransport;
  usedLocalFallback: boolean;
};

export type ConfirmVoiceDecision = {
  changeId: string;
  action: "accept" | "reject";
  value?: unknown;
};

export type ConfirmVoiceProposalRequest = {
  caseId: string;
  proposalSetId: string;
  expectedVersion: number;
  reviewedBy: string;
  decisions: ConfirmVoiceDecision[];
};

export type ConfirmVoiceProposalResponse = {
  confirmedState: {
    caseId: string;
    version: number;
    facts: Record<string, unknown>;
    updatedAt?: string;
  };
  audit: {
    auditId: string;
    occurredAt: string;
    fromVersion: number;
    toVersion: number;
  };
  message: string;
};
