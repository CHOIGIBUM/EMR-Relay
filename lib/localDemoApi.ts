import {
  CARDIO_DEMO_DISPATCH,
  CARDIO_DEMO_HOSPITALS,
  CARDIO_DEMO_PTT_UPDATES,
  CARDIO_DEMO_VITALS,
  type CardioPttProposal,
  type CardioVitalSet,
} from "@/lib/cardioDemoData";
import type {
  HospitalDirectoryResponse,
  RouteReferenceRequest,
  RouteReferenceResponse,
  VoiceFactStatus,
  VoiceProposalResponse,
  VoiceProposalSource,
  VoiceProposalWarning,
  VoiceProposedUpdate,
} from "@/lib/emsApiTypes";
import type { LocalHealthResponse } from "@/lib/localDemoTypes";
import { createStraightLineFallback } from "@/lib/routeReference";

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
  "U01-airway": "assessment.airway",
  "U01-breathing": "assessment.breathing",
  "U01-circulation": "assessment.circulation",
  "U01-age": "patient.age",
  "U01-complaint": "symptoms.chiefComplaint",
  "U01-avpu": "consciousness.avpu",
  "U02-onset": "symptoms.onsetAt",
  "U02-nrs": "symptoms.chestPainNrs",
  "U02-quality": "symptoms.chestPainQuality",
  "U02-radiation": "symptoms.chestPainRadiation",
  "U02-associated": "symptoms.associated",
  "U02-history": "history.conditions",
  "U02-medication": "history.medications",
  "U02-allergy": "history.allergies",
  "U03-vitals": "vitals.initial",
  "U03-ecg": "assessment.ecg",
  "U03-treatment": "treatment.procedures",
  "U04-vitals": "vitals.reassessment",
  "U04-outcome": "reassessment.outcome",
  "U04-impression": "clinical.prehospital_impression",
};

function structuredProposal(
  id: string,
  path: string,
  label: string,
  value: unknown,
  displayValue: string,
  evidence: string,
  kind: VoiceProposalSource["kind"],
  unit: string | null = null,
): VoiceProposedUpdate {
  return {
    proposal_id: id,
    field_path: path,
    display_label: label,
    display_value: displayValue,
    value,
    unit,
    fact_status: "proposed",
    review_state: "pending_review",
    source: { kind, evidence, observed_at: null },
  };
}

/** Strictly parses only the sentence templates emitted by MobileApp's form. */
function structuredManualUpdates(updateId: string, transcript: string): VoiceProposedUpdate[] | null {
  if (updateId.endsWith("-U01")) {
    const match = transcript.match(/^환자 접촉 후 초기 평가입니다\. 기도 (개방|확보 필요), 호흡 (자발호흡|호흡 이상), 순환 (맥박 촉지|순환 불안정)입니다\. 의식수준은 AVPU ([AVPU])입니다\. 주호소는 (.{1,200})입니다\.$/u);
    if (!match) return null;
    const [, airway, breathing, circulation, avpu, complaint] = match;
    return [
      structuredProposal("LOCAL-U01-airway", "assessment.airway", "A · 기도", airway, airway, airway, "paramedic_observation"),
      structuredProposal("LOCAL-U01-breathing", "assessment.breathing", "B · 호흡", breathing, breathing, breathing, "paramedic_observation"),
      structuredProposal("LOCAL-U01-circulation", "assessment.circulation", "C · 순환", circulation, circulation, circulation, "paramedic_observation"),
      structuredProposal("LOCAL-U01-avpu", "consciousness.avpu", "의식 수준(AVPU)", avpu, `AVPU ${avpu}`, `AVPU ${avpu}`, "paramedic_observation"),
      structuredProposal("LOCAL-U01-complaint", "symptoms.chiefComplaint", "주호소", complaint, complaint, complaint, "patient_or_caregiver_statement"),
    ];
  }

  if (updateId.endsWith("-U02")) {
    const match = transcript.match(/^증상 발생시각은 ([0-2]\d:[0-5]\d)입니다\. 흉통은 NRS (10|[0-9]), ([^,.]{1,60}) 양상이며 방사통은 ([^.]{1,60})입니다\. 동반증상은 ([^.]{1,200})입니다\. 과거력은 ([^,]{1,200}), 복용약은 ([^,]{1,200}), 알레르기는 ([^.]{1,200})입니다\.$/u);
    if (!match) return null;
    const [, onset, nrs, quality, radiation, associatedText, history, medication, allergy] = match;
    const associated = associatedText.split(/[,·]/u).map((item) => item.trim()).filter(Boolean);
    const proposals = [
      structuredProposal("LOCAL-U02-onset", "symptoms.onsetAt", "증상 발생시각", onset, onset, onset, "patient_or_caregiver_statement"),
      structuredProposal("LOCAL-U02-nrs", "symptoms.chestPainNrs", "흉통 NRS", Number(nrs), nrs, `NRS ${nrs}`, "patient_or_caregiver_statement"),
      structuredProposal("LOCAL-U02-quality", "symptoms.chestPainQuality", "흉통 양상", quality, quality, quality, "patient_or_caregiver_statement"),
      structuredProposal("LOCAL-U02-radiation", "symptoms.chestPainRadiation", "방사통", radiation, radiation, radiation, "patient_or_caregiver_statement"),
      structuredProposal("LOCAL-U02-associated", "symptoms.associated", "동반 증상", associated, associated.join(" · "), associatedText, "patient_or_caregiver_statement"),
    ];
    if (history !== "미확인") proposals.push(structuredProposal("LOCAL-U02-history", "history.conditions", "과거력", [history], history, history, "patient_or_caregiver_statement"));
    if (medication !== "미확인") proposals.push(structuredProposal("LOCAL-U02-medication", "history.medications", "복용약", [medication], medication, medication, "patient_or_caregiver_statement"));
    if (allergy !== "미확인") proposals.push(structuredProposal("LOCAL-U02-allergy", "history.allergies", "알레르기", [allergy], allergy, allergy, "patient_or_caregiver_statement"));
    return proposals;
  }

  if (updateId.endsWith("-U03")) {
    const match = transcript.match(/^최초 활력징후는 혈압 (\d{2,3})\/(\d{2,3}) mmHg, 맥박 (\d{1,3})회\/분, 호흡수 (\d{1,2})회\/분, 산소포화도 (\d{1,3})%, 체온 (\d{2}(?:\.\d+)?)도, 혈당 (\d{1,4}) mg\/dL입니다\. 시행 처치는 ([^.]{1,200})입니다\.$/u);
    if (!match) return null;
    const [, sbp, dbp, pulse, rr, spo2, temperature, glucose, treatment] = match;
    return [
      structuredProposal("LOCAL-U03-sbp", "vitals.systolicBp", "수축기혈압", Number(sbp), `${sbp} mmHg`, sbp, "device_measurement", "mmHg"),
      structuredProposal("LOCAL-U03-dbp", "vitals.diastolicBp", "이완기혈압", Number(dbp), `${dbp} mmHg`, dbp, "device_measurement", "mmHg"),
      structuredProposal("LOCAL-U03-pulse", "vitals.pulse", "맥박", Number(pulse), `${pulse} 회/분`, pulse, "device_measurement", "/min"),
      structuredProposal("LOCAL-U03-rr", "vitals.respiratoryRate", "호흡수", Number(rr), `${rr} 회/분`, rr, "device_measurement", "/min"),
      structuredProposal("LOCAL-U03-spo2", "vitals.spo2", "산소포화도", Number(spo2), `${spo2}%`, spo2, "device_measurement", "%"),
      structuredProposal("LOCAL-U03-temp", "vitals.temperature", "체온", Number(temperature), `${temperature} ℃`, temperature, "device_measurement", "°C"),
      structuredProposal("LOCAL-U03-glucose", "vitals.glucose", "혈당", Number(glucose), `${glucose} mg/dL`, glucose, "device_measurement", "mg/dL"),
      structuredProposal("LOCAL-U03-treatment", "treatment.procedures", "시행 처치", [treatment], treatment, treatment, "team_record"),
    ];
  }

  return null;
}

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
  if (proposal.id === "U02-nrs") return Number(proposal.displayValue);
  if (proposal.id === "U02-associated") return proposal.displayValue.split("·").map((value) => value.trim()).filter(Boolean);
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
  const manualUpdates = structuredManualUpdates(updateId, transcript);
  if (transcript !== reference.transcript && !manualUpdates) {
    throw new LocalDemoApiError(
      422,
      "unsupported_local_transcript",
      "현재 로컬 모드는 준비된 인식 문장만 검증합니다. 실제 발화는 원격 Agent 백엔드에 연결하세요.",
    );
  }

  const proposedUpdates: VoiceProposedUpdate[] = manualUpdates ?? reference.proposals.flatMap((proposal) => {
    if (proposal.id === "U03-vitals") {
      const vital = CARDIO_DEMO_VITALS[0];
      return [
        structuredProposal("U03-sbp", "vitals.systolicBp", "수축기혈압", vital.bloodPressure.systolic, `${vital.bloodPressure.systolic} mmHg`, proposal.evidence, "device_measurement", "mmHg"),
        structuredProposal("U03-dbp", "vitals.diastolicBp", "이완기혈압", vital.bloodPressure.diastolic, `${vital.bloodPressure.diastolic} mmHg`, proposal.evidence, "device_measurement", "mmHg"),
        structuredProposal("U03-pulse", "vitals.pulse", "맥박", vital.heartRate.value, `${vital.heartRate.value} 회/분`, proposal.evidence, "device_measurement", "/min"),
        structuredProposal("U03-rr", "vitals.respiratoryRate", "호흡수", vital.respiratoryRate.value, `${vital.respiratoryRate.value} 회/분`, proposal.evidence, "device_measurement", "/min"),
        structuredProposal("U03-spo2", "vitals.spo2", "산소포화도", vital.spo2.value, `${vital.spo2.value}%`, proposal.evidence, "device_measurement", "%"),
        structuredProposal("U03-temp", "vitals.temperature", "체온", vital.temperature.value, `${vital.temperature.value} ℃`, proposal.evidence, "device_measurement", "°C"),
        structuredProposal("U03-glucose", "vitals.glucose", "혈당", vital.bloodGlucose.value, `${vital.bloodGlucose.value} mg/dL`, proposal.evidence, "device_measurement", "mg/dL"),
      ];
    }
    const path = fieldPaths[proposal.id] ?? `unmapped.${proposal.id}`;
    return [{
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
    }];
  });
  const warnings = manualUpdates ? [] : reference.proposals.flatMap((proposal) => {
    const warning = warningFor(proposal, fieldPaths[proposal.id] ?? `unmapped.${proposal.id}`);
    return warning ? [warning] : [];
  });
  const unknownCount = proposedUpdates.filter((proposal) => proposal.fact_status === "unknown").length;
  const attentionCount = proposedUpdates.filter((proposal) => proposal.fact_status !== "proposed").length
    + (manualUpdates ? 0 : reference.proposals.filter((proposal) => proposal.status === "pending_review").length);

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
      latitude: hospital.latitude,
      longitude: hospital.longitude,
      route_source: hospital.routeSource,
      route_is_live: false,
      is_road_route: true,
      reference_source: "NMC+KAKAO_SNAPSHOT",
    })),
    reference_at: new Date().toISOString(),
    source: "local_fixture",
  };
}

const coordinateMatches = (
  value: { latitude: number; longitude: number },
  expected: { latitude: number; longitude: number },
) => Math.abs(value.latitude - expected.latitude) < 0.000001
  && Math.abs(value.longitude - expected.longitude) < 0.000001;

export function getLocalRouteReference(input: RouteReferenceRequest): RouteReferenceResponse {
  const calculatedAt = new Date().toISOString();
  const scene = CARDIO_DEMO_DISPATCH.location;
  const base = CARDIO_DEMO_DISPATCH.unitBase;
  if (coordinateMatches(input.origin, base) && coordinateMatches(input.destination, scene)) {
    return {
      distance_km: CARDIO_DEMO_DISPATCH.routeToScene.distanceKm,
      eta_minutes: CARDIO_DEMO_DISPATCH.routeToScene.etaMinutes,
      source: "kakao_mobility_snapshot",
      is_live: false,
      is_road_route: true,
      calculated_at: CARDIO_DEMO_DISPATCH.routeToScene.calculatedAt,
      notice: "저장된 카카오 자동차 경로 시연값이며 현재 교통상황은 반영하지 않습니다.",
    };
  }
  const hospital = CARDIO_DEMO_HOSPITALS.find((candidate) => (
    coordinateMatches(input.origin, scene) && coordinateMatches(input.destination, candidate)
  ));
  if (hospital) {
    return {
      distance_km: hospital.distanceKm,
      eta_minutes: hospital.etaMinutes,
      source: "kakao_mobility_snapshot",
      is_live: false,
      is_road_route: true,
      calculated_at: hospital.routeCalculatedAt,
      notice: "저장된 카카오 자동차 경로 시연값이며 현재 교통상황은 반영하지 않습니다.",
    };
  }
  const fallback = createStraightLineFallback(
    { ...input.origin, name: "출발지", address: "좌표 입력" },
    { ...input.destination, name: "도착지", address: "좌표 입력" },
    calculatedAt,
  );
  return {
    distance_km: fallback.distanceKm,
    eta_minutes: null,
    source: fallback.source,
    is_live: false,
    is_road_route: false,
    calculated_at: calculatedAt,
    notice: fallback.notice,
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
