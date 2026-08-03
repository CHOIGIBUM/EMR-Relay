import { CASE_EVENT_TYPES, type CaseCommand, type CaseEventType, type ValidationResult } from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const EVENT_TYPES = new Set<string>(CASE_EVENT_TYPES);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredId(payload: Record<string, unknown>, key: string, issues: string[]) {
  const value = payload[key];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) issues.push(`${key} 형식이 올바르지 않습니다.`);
}

function optionalText(payload: Record<string, unknown>, key: string, max: number, issues: string[]) {
  const value = payload[key];
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0 || value.length > max)) {
    issues.push(`${key}는 1~${max}자의 문자열이어야 합니다.`);
  }
}

function validatePayload(type: CaseEventType, payload: Record<string, unknown>) {
  const issues: string[] = [];
  switch (type) {
    case "CASE_ASSIGNED":
      if (!Array.isArray(payload.assignedParamedicIds)
        || payload.assignedParamedicIds.length === 0
        || payload.assignedParamedicIds.length > 12
        || payload.assignedParamedicIds.some((value) => typeof value !== "string" || !ID_PATTERN.test(value))) {
        issues.push("assignedParamedicIds는 1~12개의 사용자 ID 배열이어야 합니다.");
      }
      optionalText(payload, "scenario", 120, issues);
      optionalText(payload, "agency", 120, issues);
      optionalText(payload, "unitId", 80, issues);
      optionalText(payload, "vehicleNumber", 80, issues);
      optionalText(payload, "reportedAt", 40, issues);
      break;
    case "HOSPITAL_REQUEST_CREATED":
      requiredId(payload, "requestId", issues);
      requiredId(payload, "hospitalId", issues);
      optionalText(payload, "hospitalName", 160, issues);
      break;
    case "HOSPITAL_REQUEST_VIEWED":
    case "HANDOFF_ACCEPTED":
      requiredId(payload, "requestId", issues);
      break;
    case "ADDITIONAL_INFO_REQUESTED":
    case "ADDITIONAL_INFO_SENT":
      requiredId(payload, "requestId", issues);
      optionalText(payload, "message", 1_000, issues);
      if (typeof payload.message !== "string") issues.push("message가 필요합니다.");
      break;
    case "HOSPITAL_RESPONSE_RECORDED":
      requiredId(payload, "requestId", issues);
      if (payload.decision !== "ACCEPTED" && payload.decision !== "DECLINED") issues.push("decision은 ACCEPTED 또는 DECLINED여야 합니다.");
      optionalText(payload, "reasonCode", 80, issues);
      optionalText(payload, "reasonText", 500, issues);
      if (payload.decision === "DECLINED" && typeof payload.reasonCode !== "string" && typeof payload.reasonText !== "string") {
        issues.push("수용 곤란 회신에는 reasonCode 또는 reasonText가 필요합니다.");
      }
      break;
    case "DESTINATION_CONFIRMED_BY_PARAMEDIC":
      requiredId(payload, "requestId", issues);
      requiredId(payload, "hospitalId", issues);
      break;
    case "HANDOFF_SENT":
      optionalText(payload, "summary", 2_000, issues);
      optionalText(payload, "receiver", 160, issues);
      break;
    case "REASSESSMENT_CONFIRMED":
      optionalText(payload, "summary", 1_000, issues);
      break;
    default:
      break;
  }
  return issues;
}

export function validateCaseCommand(value: unknown): ValidationResult<CaseCommand> {
  if (!isRecord(value)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };
  const issues: string[] = [];
  if (typeof value.commandId !== "string" || !ID_PATTERN.test(value.commandId)) issues.push("commandId 형식이 올바르지 않습니다.");
  if (typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) issues.push("지원하지 않는 command type입니다.");
  if (value.expectedVersion !== undefined && (!Number.isInteger(value.expectedVersion) || Number(value.expectedVersion) < 0)) {
    issues.push("expectedVersion은 0 이상의 정수여야 합니다.");
  }
  if (!isRecord(value.payload)) issues.push("payload는 JSON 객체여야 합니다.");
  if (typeof value.type === "string" && EVENT_TYPES.has(value.type) && isRecord(value.payload)) {
    issues.push(...validatePayload(value.type as CaseEventType, value.payload));
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      commandId: value.commandId as string,
      type: value.type as CaseEventType,
      payload: value.payload as Record<string, unknown>,
      ...(typeof value.expectedVersion === "number" ? { expectedVersion: value.expectedVersion } : {}),
    },
  };
}

export function validateRealtimeSession(value: unknown): ValidationResult<{ caseId: string }> {
  if (!isRecord(value) || typeof value.caseId !== "string" || !ID_PATTERN.test(value.caseId)) {
    return { ok: false, issues: ["caseId 형식이 올바르지 않습니다."] };
  }
  return { ok: true, value: { caseId: value.caseId } };
}

export function validateTranscribeSession(value: unknown): ValidationResult<{
  caseId: string;
  languageCode: "ko-KR";
  sampleRateHertz: 16_000;
}> {
  if (!isRecord(value)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };
  const issues: string[] = [];
  if (typeof value.caseId !== "string" || !ID_PATTERN.test(value.caseId)) issues.push("caseId 형식이 올바르지 않습니다.");
  if (value.languageCode !== undefined && value.languageCode !== "ko-KR") issues.push("MVP는 ko-KR만 지원합니다.");
  if (value.sampleRateHertz !== undefined && value.sampleRateHertz !== 16_000) issues.push("MVP는 16 kHz PCM만 지원합니다.");
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { caseId: value.caseId as string, languageCode: "ko-KR", sampleRateHertz: 16_000 } };
}
