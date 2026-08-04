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

function optionalNumber(
  payload: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  issues: string[],
  allowNull = false,
) {
  const value = payload[key];
  if (value === undefined || (allowNull && value === null)) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issues.push(`${key}는 ${min}~${max} 범위의 숫자여야 합니다.`);
  }
}

function requiredNumber(
  payload: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  issues: string[],
  allowNull = false,
) {
  if (!(key in payload)) {
    issues.push(`${key} is required.`);
    return;
  }
  optionalNumber(payload, key, min, max, issues, allowNull);
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
      optionalNumber(payload, "distanceKm", 0, 2_000, issues);
      optionalNumber(payload, "etaMinutes", 0, 1_440, issues, true);
      break;
    case "HOSPITAL_BROADCAST_STARTED": {
      requiredId(payload, "broadcastId", issues);
      if (!Number.isInteger(payload.wave) || Number(payload.wave) < 1 || Number(payload.wave) > 100) {
        issues.push("wave must be an integer from 1 to 100.");
      }
      requiredNumber(payload, "radiusKm", 0.1, 2_000, issues);
      if (!Number.isInteger(payload.responseWindowSeconds)
        || Number(payload.responseWindowSeconds) < 30
        || Number(payload.responseWindowSeconds) > 3_600) {
        issues.push("responseWindowSeconds must be an integer from 30 to 3600.");
      }
      if (!Array.isArray(payload.hospitals) || payload.hospitals.length < 1 || payload.hospitals.length > 3) {
        issues.push("hospitals must contain 1 to 3 hospital request snapshots.");
        break;
      }
      const requestIds = new Set<string>();
      const hospitalIds = new Set<string>();
      payload.hospitals.forEach((hospital, index) => {
        if (!isRecord(hospital)) {
          issues.push(`hospitals[${index}] must be an object.`);
          return;
        }
        const targetIssues: string[] = [];
        requiredId(hospital, "requestId", targetIssues);
        requiredId(hospital, "hospitalId", targetIssues);
        optionalText(hospital, "hospitalName", 160, targetIssues);
        if (typeof hospital.hospitalName !== "string") targetIssues.push("hospitalName is required.");
        requiredNumber(hospital, "distanceKm", 0, 2_000, targetIssues);
        requiredNumber(hospital, "etaMinutes", 0, 1_440, targetIssues, true);
        issues.push(...targetIssues.map((issue) => `hospitals[${index}].${issue}`));

        if (typeof hospital.requestId === "string") {
          if (requestIds.has(hospital.requestId)) issues.push(`hospitals[${index}].requestId must be unique within a broadcast.`);
          requestIds.add(hospital.requestId);
        }
        if (typeof hospital.hospitalId === "string") {
          if (hospitalIds.has(hospital.hospitalId)) issues.push(`hospitals[${index}].hospitalId must be unique within a broadcast.`);
          hospitalIds.add(hospital.hospitalId);
        }
      });
      break;
    }
    case "HOSPITAL_REQUEST_VIEWED":
      requiredId(payload, "requestId", issues);
      break;
    case "HANDOFF_ACCEPTED":
      requiredId(payload, "requestId", issues);
      optionalText(payload, "receiver", 160, issues);
      optionalText(payload, "role", 80, issues);
      if (typeof payload.receiver !== "string") issues.push("receiver가 필요합니다.");
      if (typeof payload.role !== "string") issues.push("role이 필요합니다.");
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
