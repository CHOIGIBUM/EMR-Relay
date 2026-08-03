import {
  ALLOWED_FACT_PATHS,
  type AgentModelOutput,
  type AgentRequest,
  type ConfirmDecision,
  type ConfirmRequest,
  type FactPath,
  type ProposalValue,
  type ValidationResult,
} from "./types.js";

const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const USER_ID_PATTERN = /^[^\s].{0,99}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const SOURCES = new Set(["ptt", "manual", "asr_test"]);
const CERTAINTIES = new Set(["clear", "needs_confirmation", "unknown"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);
const FACT_PATHS = new Set<string>(ALLOWED_FACT_PATHS);

export const PROPOSAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "changes", "flags"],
  properties: {
    schemaVersion: { type: "string", const: "1.0" },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    changes: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "value", "certainty", "sourceText"],
        properties: {
          path: { type: "string", enum: [...ALLOWED_FACT_PATHS] },
          value: {
            anyOf: [
              { type: "string", maxLength: 500 },
              { type: "number" },
              { type: "boolean" },
              { type: "null" },
              { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
            ],
          },
          unit: { type: "string", maxLength: 30 },
          observedAt: { type: "string", maxLength: 40 },
          certainty: { type: "string", enum: ["clear", "needs_confirmation", "unknown"] },
          sourceText: { type: "string", minLength: 1, maxLength: 300 },
          note: { type: "string", maxLength: 300 },
        },
      },
    },
    flags: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 60 },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          field: { type: "string", enum: [...ALLOWED_FACT_PATHS] },
          message: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProposalValue(value: unknown): value is ProposalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return Array.isArray(value) && value.length <= 20 && value.every((entry) => typeof entry === "string");
}

function validOptionalIsoDate(value: unknown) {
  return value === undefined || (typeof value === "string" && ISO_DATE_PATTERN.test(value));
}

export function validateAgentRequest(value: unknown): ValidationResult<AgentRequest> {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };

  if (typeof value.caseId !== "string" || !CASE_ID_PATTERN.test(value.caseId)) issues.push("caseId 형식이 올바르지 않습니다.");
  if (typeof value.transcript !== "string" || value.transcript.trim().length === 0 || value.transcript.length > 10_000) {
    issues.push("transcript는 1~10,000자의 문자열이어야 합니다.");
  }
  if (typeof value.source !== "string" || !SOURCES.has(value.source)) issues.push("source는 ptt, manual, asr_test 중 하나여야 합니다.");
  if (typeof value.requestedBy !== "string" || !USER_ID_PATTERN.test(value.requestedBy)) issues.push("requestedBy 형식이 올바르지 않습니다.");
  if (!validOptionalIsoDate(value.observedAt)) issues.push("observedAt은 시간대가 포함된 ISO 8601 형식이어야 합니다.");

  if (issues.length) return { ok: false, issues };
  const result: AgentRequest = {
    caseId: value.caseId as string,
    transcript: (value.transcript as string).trim(),
    source: value.source as AgentRequest["source"],
    requestedBy: value.requestedBy as string,
  };
  if (typeof value.observedAt === "string") result.observedAt = value.observedAt;
  return { ok: true, value: result };
}

export function validateConfirmRequest(value: unknown): ValidationResult<ConfirmRequest> {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };

  if (typeof value.proposalId !== "string" || !CASE_ID_PATTERN.test(value.proposalId)) issues.push("proposalId 형식이 올바르지 않습니다.");
  if (!Number.isInteger(value.expectedVersion) || Number(value.expectedVersion) < 0) issues.push("expectedVersion은 0 이상의 정수여야 합니다.");
  if (typeof value.reviewedBy !== "string" || !USER_ID_PATTERN.test(value.reviewedBy)) issues.push("reviewedBy 형식이 올바르지 않습니다.");

  const decisions: ConfirmDecision[] = [];
  if (!Array.isArray(value.decisions) || value.decisions.length === 0 || value.decisions.length > 30) {
    issues.push("decisions는 1~30개 항목의 배열이어야 합니다.");
  } else {
    const seen = new Set<string>();
    value.decisions.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push(`decisions[${index}]는 객체여야 합니다.`);
        return;
      }
      if (typeof entry.changeId !== "string" || !CASE_ID_PATTERN.test(entry.changeId)) {
        issues.push(`decisions[${index}].changeId 형식이 올바르지 않습니다.`);
        return;
      }
      if (seen.has(entry.changeId)) issues.push(`changeId ${entry.changeId}가 중복되었습니다.`);
      seen.add(entry.changeId);
      if (entry.action !== "accept" && entry.action !== "reject") {
        issues.push(`decisions[${index}].action은 accept 또는 reject여야 합니다.`);
        return;
      }
      if (entry.value !== undefined && !isProposalValue(entry.value)) {
        issues.push(`decisions[${index}].value 형식이 올바르지 않습니다.`);
        return;
      }
      const decision: ConfirmDecision = { changeId: entry.changeId, action: entry.action };
      if (entry.value !== undefined) decision.value = entry.value;
      decisions.push(decision);
    });
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      proposalId: value.proposalId as string,
      expectedVersion: value.expectedVersion as number,
      reviewedBy: value.reviewedBy as string,
      decisions,
    },
  };
}

export function validateAgentModelOutput(value: unknown): ValidationResult<AgentModelOutput> {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["모델 출력은 JSON 객체여야 합니다."] };
  if (value.schemaVersion !== "1.0") issues.push("schemaVersion은 1.0이어야 합니다.");
  if (typeof value.summary !== "string" || value.summary.trim().length === 0 || value.summary.length > 500) issues.push("summary 형식이 올바르지 않습니다.");

  const changes: AgentModelOutput["changes"] = [];
  if (!Array.isArray(value.changes) || value.changes.length > 30) {
    issues.push("changes는 최대 30개 항목의 배열이어야 합니다.");
  } else {
    value.changes.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push(`changes[${index}]는 객체여야 합니다.`);
        return;
      }
      if (typeof entry.path !== "string" || !FACT_PATHS.has(entry.path)) issues.push(`changes[${index}].path가 허용 목록에 없습니다.`);
      if (!isProposalValue(entry.value)) issues.push(`changes[${index}].value 형식이 올바르지 않습니다.`);
      if (typeof entry.certainty !== "string" || !CERTAINTIES.has(entry.certainty)) issues.push(`changes[${index}].certainty 형식이 올바르지 않습니다.`);
      if (typeof entry.sourceText !== "string" || entry.sourceText.trim().length === 0 || entry.sourceText.length > 300) issues.push(`changes[${index}].sourceText 형식이 올바르지 않습니다.`);
      if (entry.unit !== undefined && (typeof entry.unit !== "string" || entry.unit.length > 30)) issues.push(`changes[${index}].unit 형식이 올바르지 않습니다.`);
      if (!validOptionalIsoDate(entry.observedAt)) issues.push(`changes[${index}].observedAt은 ISO 8601 형식이어야 합니다.`);
      if (entry.note !== undefined && (typeof entry.note !== "string" || entry.note.length > 300)) issues.push(`changes[${index}].note 형식이 올바르지 않습니다.`);

      if (typeof entry.path === "string" && FACT_PATHS.has(entry.path) && isProposalValue(entry.value)
        && typeof entry.certainty === "string" && CERTAINTIES.has(entry.certainty)
        && typeof entry.sourceText === "string" && entry.sourceText.trim()) {
        const change: AgentModelOutput["changes"][number] = {
          path: entry.path as FactPath,
          value: entry.value,
          certainty: entry.certainty as AgentModelOutput["changes"][number]["certainty"],
          sourceText: entry.sourceText.trim(),
        };
        if (typeof entry.unit === "string") change.unit = entry.unit;
        if (typeof entry.observedAt === "string") change.observedAt = entry.observedAt;
        if (typeof entry.note === "string") change.note = entry.note;
        changes.push(change);
      }
    });
  }

  const flags: AgentModelOutput["flags"] = [];
  if (!Array.isArray(value.flags) || value.flags.length > 20) {
    issues.push("flags는 최대 20개 항목의 배열이어야 합니다.");
  } else {
    value.flags.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push(`flags[${index}]는 객체여야 합니다.`);
        return;
      }
      if (typeof entry.code !== "string" || !entry.code.trim() || entry.code.length > 60) issues.push(`flags[${index}].code 형식이 올바르지 않습니다.`);
      if (typeof entry.severity !== "string" || !SEVERITIES.has(entry.severity)) issues.push(`flags[${index}].severity 형식이 올바르지 않습니다.`);
      if (entry.field !== undefined && (typeof entry.field !== "string" || !FACT_PATHS.has(entry.field))) issues.push(`flags[${index}].field가 허용 목록에 없습니다.`);
      if (typeof entry.message !== "string" || !entry.message.trim() || entry.message.length > 300) issues.push(`flags[${index}].message 형식이 올바르지 않습니다.`);

      if (typeof entry.code === "string" && entry.code.trim()
        && typeof entry.severity === "string" && SEVERITIES.has(entry.severity)
        && typeof entry.message === "string" && entry.message.trim()) {
        const flag: AgentModelOutput["flags"][number] = {
          code: entry.code.trim(),
          severity: entry.severity as AgentModelOutput["flags"][number]["severity"],
          message: entry.message.trim(),
        };
        if (typeof entry.field === "string" && FACT_PATHS.has(entry.field)) flag.field = entry.field as FactPath;
        flags.push(flag);
      }
    });
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { schemaVersion: "1.0", summary: (value.summary as string).trim(), changes, flags } };
}

export function isCaseId(value: string) {
  return CASE_ID_PATTERN.test(value);
}
