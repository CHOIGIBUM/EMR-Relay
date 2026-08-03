import {
  CARDIO_DEMO_HOSPITALS,
  CARDIO_DEMO_PTT_UPDATES,
  CARDIO_DEMO_VITALS,
  type CardioPttProposal,
  type CardioVitalSet,
} from "@/lib/cardioDemoData";
import type {
  HospitalDirectoryResponse,
  VoiceFactStatus,
  VoiceProposalResponse,
  VoiceProposalSource,
  VoiceProposalWarning,
  VoiceProposedUpdate,
} from "@/lib/emsApiTypes";
import type { LocalHealthResponse } from "@/lib/localDemoTypes";

export type LocalVoiceProposalRequest = {
  case_id?: unknown;
  update_id?: unknown;
  transcript?: unknown;
  locale?: unknown;
  client_event_id?: unknown;
  incidentId?: unknown;
  updateId?: unknown;
};

export class LocalDemoApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LocalDemoApiError";
    this.status = status;
    this.code = code;
  }
}

const fieldPaths: Record<string, string> = {
  "U01-age": "patient.age_years_and_sex",
  "U01-complaint": "clinical.chief_complaint",
  "U01-avpu": "assessment.avpu",
  "U02-onset": "symptoms.onset.reported_at",
  "U02-history": "history.conditions",
  "U02-medication": "history.medication",
  "U02-allergy": "history.allergies",
  "U03-vitals": "vitals.initial",
  "U03-ecg": "ecg.summary",
  "U03-treatment": "interventions.performed_types",
  "U04-vitals": "vitals.reassessment",
  "U04-outcome": "reassessment.outcome",
  "U04-impression": "clinical.prehospital_impression",
};

function sourceKind(label: string): VoiceProposalSource["kind"] {
  if (label.includes("측정")) return "device_measurement";
  if (label.includes("환자") || label.includes("보호자")) return "patient_or_caregiver_statement";
  if (label.includes("기록")) return "team_record";
  if (label.includes("판단")) return "paramedic_impression";
  return "paramedic_observation";
}

function factStatus(proposal: CardioPttProposal): VoiceFactStatus {
  if (proposal.status === "unknown") return "unknown";
  if (proposal.status === "unconfirmed") return "unconfirmed";
  return "proposed";
}

function vitalValue(vital: CardioVitalSet) {
  return {
    sbp_mmHg: vital.bloodPressure.systolic,
    dbp_mmHg: vital.bloodPressure.diastolic,
    heart_rate_per_min: vital.heartRate.value,
    respiratory_rate_per_min: vital.respiratoryRate.value,
    spo2_percent: vital.spo2.value,
    temperature_celsius: vital.temperature.value,
    blood_glucose_mg_dL: vital.bloodGlucose.value,
    measured_at: vital.measuredAt,
  };
}

function proposalValue(proposal: CardioPttProposal): unknown {
  if (proposal.id === "U01-avpu") return "A";
  if (proposal.id === "U03-vitals") return vitalValue(CARDIO_DEMO_VITALS[0]);
  if (proposal.id === "U04-vitals") return vitalValue(CARDIO_DEMO_VITALS[1]);
  return proposal.displayValue;
}

function warningFor(proposal: CardioPttProposal, path: string): VoiceProposalWarning | null {
  if (proposal.status === "unknown") {
    return {
      code: "UNRESOLVED_VALUE",
      severity: "warning",
      message: `${proposal.label}은 미상 상태입니다. 임의로 '없음'으로 바꾸지 마세요.`,
      field_paths: [path],
    };
  }
  if (proposal.status === "unconfirmed") {
    return {
      code: "STATEMENT_NEEDS_CONFIRMATION",
      severity: "warning",
      message: `${proposal.label}은 진술 기반 정보로 추가 확인이 필요합니다.`,
      field_paths: [path],
    };
  }
  if (proposal.status === "pending_review") {
    return {
      code: "CLINICAL_JUDGMENT_REVIEW",
      severity: "warning",
      message: `${proposal.label}은 구급대원의 판단 확인이 필요합니다.`,
      field_paths: [path],
    };
  }
  return null;
}

/**
 * Browser-only scripted fixture used by the explicit demo workflow. It is not
 * a clinical parser and never maps an arbitrary utterance to prepared facts.
 */
export async function createLocalVoiceProposal(
  body: LocalVoiceProposalRequest,
): Promise<VoiceProposalResponse> {
  const caseIdValue = body.case_id ?? body.incidentId;
  const updateIdValue = body.update_id ?? body.updateId;
  const caseId = typeof caseIdValue === "string" ? caseIdValue.trim() : "";
  const updateId = typeof updateIdValue === "string" ? updateIdValue.trim() : "";
  const transcript = typeof body.transcript === "string" ? body.transcript.normalize("NFKC").trim() : "";

  if (!caseId || !updateId || !transcript || transcript.length > 4_000) {
    throw new LocalDemoApiError(
      400,
      "invalid_voice_update",
      "case_id, update_id와 1~4,000자의 transcript가 필요합니다.",
    );
  }
  if (caseId !== "GW-CARDIO-050") {
    throw new LocalDemoApiError(404, "unknown_case", "로컬 검증 계약에 등록되지 않은 사건입니다.");
  }

  const reference = CARDIO_DEMO_PTT_UPDATES.find((update) => update.id === updateId);
  if (!reference) {
    throw new LocalDemoApiError(404, "unknown_update", "로컬 검증 계약에 등록되지 않은 음성 갱신입니다.");
  }
  if (transcript !== reference.transcript) {
    throw new LocalDemoApiError(
      422,
      "unsupported_local_transcript",
      "현재 로컬 모드는 준비된 인식 문장만 검증합니다. 실제 발화는 원격 Agent 백엔드에 연결하세요.",
    );
  }

  const proposedUpdates: VoiceProposedUpdate[] = reference.proposals.map((proposal) => {
    const path = fieldPaths[proposal.id] ?? `unmapped.${proposal.id}`;
    return {
      proposal_id: proposal.id,
      field_path: path,
      display_label: proposal.label,
      display_value: proposal.displayValue,
      value: proposalValue(proposal),
      unit: null,
      fact_status: factStatus(proposal),
      review_state: "pending_review",
      source: {
        kind: sourceKind(proposal.sourceLabel),
        evidence: proposal.evidence,
        observed_at: reference.endedAt,
      },
    };
  });
  const warnings = reference.proposals.flatMap((proposal) => {
    const warning = warningFor(proposal, fieldPaths[proposal.id] ?? `unmapped.${proposal.id}`);
    return warning ? [warning] : [];
  });
  const unknownCount = proposedUpdates.filter((proposal) => proposal.fact_status === "unknown").length;
  const attentionCount = proposedUpdates.filter((proposal) => proposal.fact_status !== "proposed").length
    + reference.proposals.filter((proposal) => proposal.status === "pending_review").length;

  await new Promise<void>((resolve) => setTimeout(resolve, 420));
  return {
    request_id: typeof body.client_event_id === "string" && body.client_event_id.trim()
      ? body.client_event_id.trim()
      : crypto.randomUUID(),
    case_id: caseId,
    update_id: reference.id,
    transcript,
    pending_review: true,
    proposed_updates: proposedUpdates,
    warnings,
    review_summary: {
      total_count: proposedUpdates.length,
      confirmable_count: proposedUpdates.length - unknownCount,
      attention_count: attentionCount,
      unknown_count: unknownCount,
      message: warnings.length
        ? `변경안 ${proposedUpdates.length}건 중 ${warnings.length}건을 주의해서 확인하세요.`
        : `변경안 ${proposedUpdates.length}건을 모두 확인한 뒤 반영하세요.`,
    },
    processed_at: new Date().toISOString(),
    proposal_set_id: `LOCAL-${caseId}-${reference.id}`,
    base_version: 0,
  };
}

export function getLocalHospitalDirectory(): HospitalDirectoryResponse {
  return {
    hospitals: CARDIO_DEMO_HOSPITALS.map((hospital) => ({
      hospital_id: hospital.id,
      display_name: hospital.alias,
      care_level: hospital.careLevelLabel,
      region_label: hospital.regionLabel,
      distance_km: hospital.distanceKm,
      eta_minutes: hospital.etaMinutes,
      reference_capabilities: [...hospital.referenceCapabilities],
    })),
    reference_at: new Date().toISOString(),
    source: "local_fixture",
  };
}

export function getLocalHealth(): LocalHealthResponse {
  return {
    status: "ok",
    mode: "local-mock",
    services: {
      agent: { status: "available", provider: "scripted-proposal-contract" },
      hospitals: { status: "available", provider: "static-reference-contract" },
      persistence: {
        status: "available",
        provider: "browser-local-storage-and-broadcast-channel",
      },
    },
    checkedAt: new Date().toISOString(),
  };
}
