import type { CardioPttProposal, CardioPttUpdate } from "@/lib/cardioDemoData";
import type {
  CreateVoiceProposalRequest,
  ConfirmVoiceProposalRequest,
  ConfirmVoiceProposalResponse,
  EmsApiResult,
  EmsApiTransport,
  HospitalDirectoryRequest,
  HospitalDirectoryResponse,
  VoiceFactStatus,
  VoiceProposalResponse,
  VoiceProposalSource,
  VoiceProposalWarning,
  VoiceProposedUpdate,
  VoiceReviewSummary,
} from "@/lib/emsApiTypes";

type RequestOptions = {
  signal?: AbortSignal;
  accessToken?: string;
  forceLocal?: boolean;
};

type ApiMode = "local" | "remote";

const legacyBase = process.env.NEXT_PUBLIC_EMS_API_BASE?.trim() ?? "";
const configuredMode = process.env.NEXT_PUBLIC_EMS_API_MODE?.trim().toLowerCase();
const configuredRemoteBase = process.env.NEXT_PUBLIC_EMS_BACKEND_URL?.trim() ?? "";
const configuredLocalBase = process.env.NEXT_PUBLIC_EMS_LOCAL_API_BASE?.trim() ?? "";

const remoteBase = stripTrailingSlash(
  configuredRemoteBase || (legacyBase && !legacyBase.startsWith("/") ? legacyBase : ""),
);
const localBase = stripTrailingSlash(
  configuredLocalBase || (legacyBase.startsWith("/") ? legacyBase : "/api/local"),
);
const mode: ApiMode = configuredMode === "remote"
  ? "remote"
  : configuredMode === "local"
    ? "local"
    : remoteBase
      ? "remote"
      : "local";
const allowLocalFallback = process.env.NEXT_PUBLIC_EMS_ALLOW_LOCAL_FALLBACK === "true";
const reviewerId = process.env.NEXT_PUBLIC_EMS_REVIEWER_ID?.trim() ?? "";

export const EMS_API_CONFIG = Object.freeze({
  mode,
  remoteBase,
  localBase,
  allowLocalFallback,
  reviewerId,
});

export class EmsApiError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(message: string, options?: { status?: number | null; code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "EmsApiError";
    this.status = options?.status ?? null;
    this.code = options?.code ?? "EMS_API_ERROR";
  }
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string) {
  return `${stripTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function fetchJson(
  url: string,
  init: RequestInit,
  accessToken?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new EmsApiError("백엔드에 연결할 수 없습니다.", {
      code: "NETWORK_ERROR",
      cause: error,
    });
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `백엔드 요청에 실패했습니다. (${response.status})`;
    throw new EmsApiError(apiMessage, {
      status: response.status,
      code: isRecord(payload) && typeof payload.error === "string" ? payload.error : "HTTP_ERROR",
    });
  }
  return payload;
}

function canUseFallback(error: unknown) {
  if (!allowLocalFallback) return false;
  if (!(error instanceof EmsApiError)) return false;
  return error.status === null || error.status >= 500;
}

async function requestWithPolicy<T>({
  remotePath,
  localPath,
  init,
  options,
  parse,
}: {
  remotePath: string;
  localPath: string;
  init: RequestInit;
  options?: RequestOptions;
  parse: (payload: unknown) => T;
}): Promise<EmsApiResult<T>> {
  const request = async (transport: EmsApiTransport): Promise<EmsApiResult<T>> => {
    const base = transport === "remote" ? remoteBase : localBase;
    if (!base) {
      throw new EmsApiError(
        transport === "remote"
          ? "NEXT_PUBLIC_EMS_BACKEND_URL이 설정되지 않았습니다."
          : "로컬 API 경로가 설정되지 않았습니다.",
        { code: "API_BASE_NOT_CONFIGURED" },
      );
    }
    const path = transport === "remote" ? remotePath : localPath;
    const payload = await fetchJson(joinUrl(base, path), {
      ...init,
      signal: options?.signal,
    }, options?.accessToken);
    return { data: parse(payload), transport, usedLocalFallback: false };
  };

  if (options?.forceLocal) return request("local");
  if (mode === "local") return request("local");
  try {
    return await request("remote");
  } catch (error) {
    if (!canUseFallback(error)) throw error;
    const fallback = await request("local");
    return { ...fallback, usedLocalFallback: true };
  }
}

function parseSource(value: unknown): VoiceProposalSource {
  if (!isRecord(value)) throw new EmsApiError("음성 변경안의 출처 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  const kinds: VoiceProposalSource["kind"][] = [
    "paramedic_observation",
    "patient_or_caregiver_statement",
    "device_measurement",
    "team_record",
    "paramedic_impression",
    "speech_transcript",
  ];
  if (!kinds.includes(value.kind as VoiceProposalSource["kind"]) || typeof value.evidence !== "string") {
    throw new EmsApiError("음성 변경안의 출처 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  if (value.observed_at !== null && typeof value.observed_at !== "string") {
    throw new EmsApiError("관찰시각 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    kind: value.kind as VoiceProposalSource["kind"],
    evidence: value.evidence,
    observed_at: value.observed_at as string | null,
  };
}

function parseProposedUpdate(value: unknown): VoiceProposedUpdate {
  if (!isRecord(value)) throw new EmsApiError("음성 변경안 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  const factStatuses: VoiceFactStatus[] = ["proposed", "unconfirmed", "unknown"];
  const requiredStrings = ["proposal_id", "field_path", "display_label", "display_value"] as const;
  if (requiredStrings.some((key) => typeof value[key] !== "string" || !(value[key] as string).trim())) {
    throw new EmsApiError("음성 변경안의 필수 필드가 누락되었습니다.", { code: "INVALID_CONTRACT" });
  }
  if (!factStatuses.includes(value.fact_status as VoiceFactStatus) || value.review_state !== "pending_review") {
    throw new EmsApiError("사람의 확인 전에는 확정 상태를 반환할 수 없습니다.", { code: "UNSAFE_AGENT_STATE" });
  }
  if (value.unit !== null && typeof value.unit !== "string") {
    throw new EmsApiError("음성 변경안의 단위 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    proposal_id: value.proposal_id as string,
    field_path: value.field_path as string,
    display_label: value.display_label as string,
    display_value: value.display_value as string,
    value: value.value,
    unit: value.unit as string | null,
    fact_status: value.fact_status as VoiceFactStatus,
    review_state: "pending_review",
    source: parseSource(value.source),
  };
}

function parseWarning(value: unknown): VoiceProposalWarning {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    throw new EmsApiError("검토 경고 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  const severities: VoiceProposalWarning["severity"][] = ["info", "warning", "error"];
  if (!severities.includes(value.severity as VoiceProposalWarning["severity"]) || !isStringArray(value.field_paths)) {
    throw new EmsApiError("검토 경고 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    code: value.code,
    severity: value.severity as VoiceProposalWarning["severity"],
    message: value.message,
    field_paths: value.field_paths,
  };
}

function parseReviewSummary(value: unknown): VoiceReviewSummary {
  if (!isRecord(value) || typeof value.message !== "string") {
    throw new EmsApiError("검토 요약 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  const numberKeys = ["total_count", "confirmable_count", "attention_count", "unknown_count"] as const;
  if (numberKeys.some((key) => typeof value[key] !== "number" || (value[key] as number) < 0)) {
    throw new EmsApiError("검토 요약의 집계값이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    total_count: value.total_count as number,
    confirmable_count: value.confirmable_count as number,
    attention_count: value.attention_count as number,
    unknown_count: value.unknown_count as number,
    message: value.message,
  };
}

function parseVoiceProposalResponse(payload: unknown): VoiceProposalResponse {
  if (!isRecord(payload) || payload.pending_review !== true || !Array.isArray(payload.proposed_updates) || !Array.isArray(payload.warnings)) {
    throw new EmsApiError("음성 처리 응답 계약이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  const requiredStrings = ["request_id", "case_id", "update_id", "transcript", "processed_at"] as const;
  if (requiredStrings.some((key) => typeof payload[key] !== "string")) {
    throw new EmsApiError("음성 처리 응답의 식별자가 누락되었습니다.", { code: "INVALID_CONTRACT" });
  }
  const proposedUpdates = payload.proposed_updates.map(parseProposedUpdate);
  const reviewSummary = parseReviewSummary(payload.review_summary);
  if (reviewSummary.total_count !== proposedUpdates.length) {
    throw new EmsApiError("변경안 수와 검토 요약이 일치하지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    request_id: payload.request_id as string,
    case_id: payload.case_id as string,
    update_id: payload.update_id as string,
    transcript: payload.transcript as string,
    pending_review: true,
    proposed_updates: proposedUpdates,
    warnings: payload.warnings.map(parseWarning),
    review_summary: reviewSummary,
    processed_at: payload.processed_at as string,
    proposal_set_id: typeof payload.proposal_set_id === "string" && payload.proposal_set_id.trim()
      ? payload.proposal_set_id
      : null,
    base_version: typeof payload.base_version === "number" && Number.isInteger(payload.base_version) && payload.base_version >= 0
      ? payload.base_version
      : null,
  };
}

function parseConfirmVoiceProposalResponse(payload: unknown): ConfirmVoiceProposalResponse {
  if (!isRecord(payload) || !isRecord(payload.confirmedState) || !isRecord(payload.audit) || typeof payload.message !== "string") {
    throw new EmsApiError("확정 응답 계약이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  const state = payload.confirmedState;
  const audit = payload.audit;
  if (
    typeof state.caseId !== "string"
    || typeof state.version !== "number"
    || !Number.isInteger(state.version)
    || !isRecord(state.facts)
    || typeof audit.auditId !== "string"
    || typeof audit.occurredAt !== "string"
    || typeof audit.fromVersion !== "number"
    || typeof audit.toVersion !== "number"
  ) {
    throw new EmsApiError("확정 응답의 필수 필드가 누락되었습니다.", { code: "INVALID_CONTRACT" });
  }
  return {
    confirmedState: {
      caseId: state.caseId,
      version: state.version,
      facts: state.facts,
      ...(typeof state.updatedAt === "string" ? { updatedAt: state.updatedAt } : {}),
    },
    audit: {
      auditId: audit.auditId,
      occurredAt: audit.occurredAt,
      fromVersion: audit.fromVersion,
      toVersion: audit.toVersion,
    },
    message: payload.message,
  };
}

function parseHospitalDirectory(payload: unknown): HospitalDirectoryResponse {
  if (!isRecord(payload) || !Array.isArray(payload.hospitals) || typeof payload.reference_at !== "string") {
    throw new EmsApiError("병원정보 응답 계약이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
  }
  if (!["live_reference_apis", "unavailable", "public_reference_api", "local_fixture"].includes(String(payload.source))) {
    throw new EmsApiError("병원정보 출처가 누락되었습니다.", { code: "INVALID_CONTRACT" });
  }
  const hospitals = payload.hospitals.map((item) => {
    if (!isRecord(item)) throw new EmsApiError("병원정보 항목 형식이 올바르지 않습니다.", { code: "INVALID_CONTRACT" });
    const stringKeys = ["hospital_id", "display_name", "care_level", "region_label"] as const;
    if (
      stringKeys.some((key) => typeof item[key] !== "string")
      || typeof item.distance_km !== "number"
      || typeof item.eta_minutes !== "number"
      || !isStringArray(item.reference_capabilities)
    ) {
      throw new EmsApiError("병원정보 항목의 필수값이 누락되었습니다.", { code: "INVALID_CONTRACT" });
    }
    return {
      hospital_id: item.hospital_id as string,
      display_name: item.display_name as string,
      care_level: item.care_level as string,
      region_label: item.region_label as string,
      distance_km: item.distance_km as number,
      eta_minutes: item.eta_minutes as number,
      reference_capabilities: item.reference_capabilities,
      ...(typeof item.latitude === "number" && Number.isFinite(item.latitude) ? { latitude: item.latitude } : {}),
      ...(typeof item.longitude === "number" && Number.isFinite(item.longitude) ? { longitude: item.longitude } : {}),
    };
  });
  return {
    hospitals,
    reference_at: payload.reference_at,
    source: payload.source as HospitalDirectoryResponse["source"],
  };
}

export async function createVoiceProposal(
  input: CreateVoiceProposalRequest,
  options?: RequestOptions,
): Promise<EmsApiResult<VoiceProposalResponse>> {
  const caseId = input.caseId.trim();
  const updateId = input.updateId.trim();
  const transcript = input.transcript.normalize("NFKC").trim();
  if (!caseId || !updateId || !transcript || transcript.length > 4_000) {
    throw new EmsApiError("사건번호, 갱신번호와 1~4,000자의 인식 문장이 필요합니다.", { code: "INVALID_REQUEST" });
  }
  const requestBody = {
    case_id: caseId,
    update_id: updateId,
    transcript,
    locale: input.locale ?? "ko-KR",
    client_event_id: input.clientEventId ?? crypto.randomUUID(),
  };
  return requestWithPolicy({
    remotePath: `cases/${encodeURIComponent(caseId)}/voice-updates/proposals`,
    localPath: "agent",
    init: { method: "POST", body: JSON.stringify(requestBody) },
    options,
    parse: parseVoiceProposalResponse,
  });
}

export async function getHospitalDirectory(
  input: HospitalDirectoryRequest,
  options?: RequestOptions,
): Promise<EmsApiResult<HospitalDirectoryResponse>> {
  const params = new URLSearchParams({
    case_id: input.caseId,
    lat: String(input.latitude),
    lng: String(input.longitude),
  });
  return requestWithPolicy({
    remotePath: `hospitals?${params.toString()}`,
    localPath: `hospitals?${params.toString()}`,
    init: { method: "GET" },
    options,
    parse: parseHospitalDirectory,
  });
}

/**
 * Persists HITL decisions to the canonical backend. Confirmation never falls
 * back to a local fixture because that could make two confirmed states diverge.
 */
export async function confirmVoiceProposal(
  input: ConfirmVoiceProposalRequest,
  options?: RequestOptions,
): Promise<EmsApiResult<ConfirmVoiceProposalResponse>> {
  if (mode !== "remote" || !remoteBase) {
    throw new EmsApiError("원격 확정 API가 설정되지 않았습니다.", { code: "REMOTE_CONFIRM_NOT_CONFIGURED" });
  }
  if (
    !input.caseId.trim()
    || !input.proposalSetId.trim()
    || !input.reviewedBy.trim()
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 0
  ) {
    throw new EmsApiError("확정 요청에 필요한 사건·변경안·확인자 정보가 누락되었습니다.", { code: "INVALID_CONFIRM_REQUEST" });
  }
  if (!input.decisions.length || input.decisions.some((decision) => !decision.changeId.trim())) {
    throw new EmsApiError("모든 변경항목에 대한 승인 또는 제외 결정이 필요합니다.", { code: "INCOMPLETE_REVIEW" });
  }
  const payload = await fetchJson(
    joinUrl(remoteBase, `cases/${encodeURIComponent(input.caseId)}/confirm`),
    {
      method: "POST",
      signal: options?.signal,
      body: JSON.stringify({
        proposalId: input.proposalSetId,
        expectedVersion: input.expectedVersion,
        reviewedBy: input.reviewedBy,
        decisions: input.decisions,
      }),
    },
    options?.accessToken,
  );
  return {
    data: parseConfirmVoiceProposalResponse(payload),
    transport: "remote",
    usedLocalFallback: false,
  };
}

const sourceLabels: Record<VoiceProposalSource["kind"], string> = {
  paramedic_observation: "구급대원 관찰",
  patient_or_caregiver_statement: "환자·보호자 진술",
  device_measurement: "측정값",
  team_record: "구급대 기록",
  paramedic_impression: "구급대원 판단",
  speech_transcript: "인식 문장",
};

/** Maps the backend proposal contract to the existing review-card view model. */
export function voiceProposalToPttUpdate(
  reference: CardioPttUpdate,
  response: VoiceProposalResponse,
): CardioPttUpdate {
  if (response.update_id !== reference.id) {
    throw new EmsApiError("요청한 갱신과 응답이 일치하지 않습니다.", { code: "UPDATE_ID_MISMATCH" });
  }
  const proposals: CardioPttProposal[] = response.proposed_updates.map((proposal) => ({
    id: proposal.proposal_id,
    label: proposal.display_label,
    displayValue: proposal.display_value,
    status: proposal.fact_status === "unknown"
      ? "unknown"
      : proposal.fact_status === "unconfirmed"
        ? "unconfirmed"
        : "pending_review",
    sourceLabel: sourceLabels[proposal.source.kind],
    evidence: proposal.source.evidence,
    fieldPath: proposal.field_path,
    rawValue: proposal.value,
    unit: proposal.unit,
  }));
  return {
    ...reference,
    transcript: response.transcript,
    proposals,
    needsReview: true,
  };
}
