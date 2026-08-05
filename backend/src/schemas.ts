import {
  ALLOWED_FACT_PATHS,
  type AgentModelOutput,
  type AgentRequest,
  type ConfirmDecision,
  type ConfirmRequest,
  type DirectFactsRequest,
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
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "value", "certainty", "sourceText"],
        properties: {
          path: { type: "string", enum: [...ALLOWED_FACT_PATHS] },
          value: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "null" },
              { type: "array", items: { type: "string" } },
            ],
          },
          unit: { type: "string" },
          observedAt: { type: "string", format: "date-time" },
          certainty: { type: "string", enum: ["clear", "needs_confirmation", "unknown"] },
          sourceText: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          field: { type: "string", enum: [...ALLOWED_FACT_PATHS] },
          message: { type: "string" },
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

const MODEL_NUMERIC_PATHS = new Set<FactPath>([
  "patient.age",
  "assessment.cpss.score",
  "vitals.systolicBp",
  "vitals.diastolicBp",
  "vitals.pulse",
  "vitals.respiratoryRate",
  "vitals.spo2",
  "vitals.temperature",
  "vitals.glucose",
]);

const MODEL_TEXT_PATHS = new Set<FactPath>([
  "symptoms.chiefComplaint",
  "symptoms.lastKnownNormalBasis",
]);

const MODEL_ENUM_ALIASES: Partial<Record<FactPath, Readonly<Record<string, string>>>> = {
  "patient.sex": {
    "남": "남성", "남성": "남성", "남자": "남성", "male": "남성", "m": "남성",
    "여": "여성", "여성": "여성", "여자": "여성", "female": "여성", "f": "여성",
    "미상": "미상", "unknown": "미상", "unspecified": "미상",
  },
  "assessment.airway": {
    "개방": "개방", "patent": "개방", "open": "개방",
    "확보 필요": "확보 필요", "at-risk": "확보 필요", "at risk": "확보 필요", "needs securing": "확보 필요",
  },
  "assessment.breathing": {
    "자발호흡": "자발호흡", "adequate": "자발호흡", "spontaneous": "자발호흡", "spontaneous breathing": "자발호흡",
    "호흡 이상": "호흡 이상", "inadequate": "호흡 이상", "abnormal": "호흡 이상", "labored": "호흡 이상", "distressed": "호흡 이상",
  },
  "assessment.circulation": {
    "맥박 촉지": "맥박 촉지", "stable": "맥박 촉지", "palpable pulse": "맥박 촉지", "pulse palpable": "맥박 촉지",
    "순환 불안정": "순환 불안정", "poor-perfusion": "순환 불안정", "poor perfusion": "순환 불안정", "unstable": "순환 불안정",
  },
  "assessment.cpss.face": {
    "정상": "정상", "normal": "정상", "좌측 이상": "좌측 이상", "left": "좌측 이상", "left abnormal": "좌측 이상",
    "우측 이상": "우측 이상", "right": "우측 이상", "right abnormal": "우측 이상", "평가 불가": "평가 불가", "unassessable": "평가 불가",
  },
  "assessment.cpss.arm": {
    "정상": "정상", "normal": "정상", "좌측 이상": "좌측 이상", "left": "좌측 이상", "left abnormal": "좌측 이상",
    "우측 이상": "우측 이상", "right": "우측 이상", "right abnormal": "우측 이상", "평가 불가": "평가 불가", "unassessable": "평가 불가",
  },
  "assessment.cpss.speech": {
    "정상": "정상", "normal": "정상", "구음장애": "구음장애", "dysarthria": "구음장애",
    "실어증": "실어증", "aphasia": "실어증", "평가 불가": "평가 불가", "unassessable": "평가 불가",
  },
};

function normalizeModelProposalValue(path: unknown, value: ProposalValue): ProposalValue {
  if (typeof path !== "string" || !FACT_PATHS.has(path)) return value;
  const factPath = path as FactPath;
  if (MODEL_TEXT_PATHS.has(factPath) && Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean).join(", ");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (MODEL_NUMERIC_PATHS.has(factPath) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (["consciousness.avpu", "reassessment.avpu"].includes(factPath) && /^[avpu]$/i.test(trimmed)) return trimmed.toUpperCase();
    const alias = MODEL_ENUM_ALIASES[factPath]?.[trimmed.toLowerCase().replaceAll("_", "-").replace(/\s+/g, " ")];
    if (alias) return alias;
  }
  return value;
}

/**
 * Some tool-capable models occasionally wrap a scalar proposal as
 * `{ value: <scalar>, unit?: <string> }` even though the schema defines
 * `value` and `unit` as sibling fields. Flatten only that exact syntactic
 * shape; all clinical paths, values and units still pass the normal strict
 * validator and remain pending until HITL confirmation.
 */
export function normalizeAgentModelCandidate(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.changes)) return value;

  let changed = false;
  const changes = value.changes.map((entry) => {
    if (!isRecord(entry)) return entry;
    const normalized: Record<string, unknown> = { ...entry };
    if (isRecord(entry.value)) {
      const wrapper = entry.value;
      const keys = Object.keys(wrapper);
      if (!keys.every((key) => key === "value" || key === "unit") || !isProposalValue(wrapper.value)) return entry;
      if (wrapper.unit !== undefined && typeof wrapper.unit !== "string") return entry;
      changed = true;
      normalized.value = wrapper.value;
      if (normalized.unit === undefined && typeof wrapper.unit === "string") normalized.unit = wrapper.unit;
    }
    if (isProposalValue(normalized.value)) {
      const canonicalValue = normalizeModelProposalValue(normalized.path, normalized.value);
      if (canonicalValue !== normalized.value) {
        changed = true;
        normalized.value = canonicalValue;
      }
    }
    return normalized;
  });

  return changed ? { ...value, changes } : value;
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
  if (value.updateId !== undefined && (typeof value.updateId !== "string" || !CASE_ID_PATTERN.test(value.updateId))) {
    issues.push("updateId 형식이 올바르지 않습니다.");
  }
  if (value.phase !== undefined && !["dispatch", "scene", "transport", "reassessment", "handoff"].includes(String(value.phase))) {
    issues.push("phase 형식이 올바르지 않습니다.");
  }

  if (issues.length) return { ok: false, issues };
  const result: AgentRequest = {
    caseId: value.caseId as string,
    transcript: (value.transcript as string).trim(),
    source: value.source as AgentRequest["source"],
    requestedBy: value.requestedBy as string,
  };
  if (typeof value.observedAt === "string") result.observedAt = value.observedAt;
  if (typeof value.updateId === "string") result.updateId = value.updateId;
  if (typeof value.phase === "string") result.phase = value.phase as NonNullable<AgentRequest["phase"]>;
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

function directValueIssue(path: FactPath, value: ProposalValue) {
  const numberRanges: Partial<Record<FactPath, [number, number]>> = {
    "patient.age": [0, 130],
    "symptoms.chestPainNrs": [0, 10],
    "assessment.cpss.score": [0, 3],
    "vitals.systolicBp": [20, 300],
    "vitals.diastolicBp": [10, 200],
    "vitals.pulse": [0, 300],
    "vitals.respiratoryRate": [0, 100],
    "vitals.spo2": [0, 100],
    "vitals.temperature": [20, 45],
    "vitals.glucose": [10, 1_000],
    "reassessment.systolicBp": [20, 300],
    "reassessment.diastolicBp": [10, 200],
    "reassessment.pulse": [0, 300],
    "reassessment.respiratoryRate": [0, 100],
    "reassessment.spo2": [0, 100],
    "reassessment.temperature": [20, 45],
    "reassessment.glucose": [10, 1_000],
  };
  const range = numberRanges[path];
  if (range && (typeof value !== "number" || value < range[0] || value > range[1])) {
    return `${path} 값은 ${range[0]}~${range[1]} 범위의 숫자여야 합니다.`;
  }
  if (["consciousness.avpu", "reassessment.avpu"].includes(path) && !["A", "V", "P", "U"].includes(String(value))) {
    return `${path} 값은 A, V, P, U 중 하나여야 합니다.`;
  }
  const enumValues: Partial<Record<FactPath, readonly string[]>> = {
    "assessment.airway": ["개방", "확보 필요"],
    "assessment.breathing": ["자발호흡", "호흡 이상"],
    "assessment.circulation": ["맥박 촉지", "순환 불안정"],
    "assessment.cpss.face": ["정상", "좌측 이상", "우측 이상", "평가 불가"],
    "assessment.cpss.arm": ["정상", "좌측 이상", "우측 이상", "평가 불가"],
    "assessment.cpss.speech": ["정상", "구음장애", "실어증", "평가 불가"],
  };
  const allowedValues = enumValues[path];
  if (allowedValues && !allowedValues.includes(String(value))) {
    return `${path} 값은 ${allowedValues.join(", ")} 중 하나여야 합니다.`;
  }
  if (path === "patient.sex" && !["남", "여", "남성", "여성", "미상"].includes(String(value))) {
    return "patient.sex 값은 남, 여, 남성, 여성, 미상 중 하나여야 합니다.";
  }
  return null;
}

export function validateDirectFactsRequest(value: unknown): ValidationResult<DirectFactsRequest> {
  if (!isRecord(value)) return { ok: false, issues: ["요청 본문은 JSON 객체여야 합니다."] };
  const issues: string[] = [];
  if (value.kind !== "initial" && value.kind !== "reassessment") issues.push("kind는 initial 또는 reassessment여야 합니다.");
  if (!Number.isInteger(value.expectedVersion) || Number(value.expectedVersion) < 0) {
    issues.push("expectedVersion은 0 이상의 정수여야 합니다.");
  }
  const facts: DirectFactsRequest["facts"] = [];
  const seen = new Set<string>();
  if (!Array.isArray(value.facts) || value.facts.length === 0 || value.facts.length > 30) {
    issues.push("facts는 1~30개 항목의 배열이어야 합니다.");
  } else {
    value.facts.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push(`facts[${index}]는 객체여야 합니다.`);
        return;
      }
      if (typeof entry.path !== "string" || !FACT_PATHS.has(entry.path)) {
        issues.push(`facts[${index}].path가 허용 목록에 없습니다.`);
        return;
      }
      const path = entry.path as FactPath;
      const isReassessmentPath = path.startsWith("reassessment.") || path === "transport.reassessment";
      if (value.kind === "initial" && isReassessmentPath) {
        issues.push(`facts[${index}].path는 최초 평가 입력에 사용할 수 없습니다.`);
      }
      if (value.kind === "reassessment" && !isReassessmentPath) {
        issues.push(`facts[${index}].path는 이송 중 재평가 입력에 사용할 수 없습니다.`);
      }
      if (seen.has(path)) issues.push(`facts[${index}].path가 중복되었습니다.`);
      seen.add(path);
      if (!isProposalValue(entry.value)) {
        issues.push(`facts[${index}].value 형식이 올바르지 않습니다.`);
        return;
      }
      const rangeIssue = directValueIssue(path, entry.value);
      if (rangeIssue) issues.push(rangeIssue);
      if (!validOptionalIsoDate(entry.observedAt)) issues.push(`facts[${index}].observedAt은 ISO 8601 형식이어야 합니다.`);
      if (typeof entry.sourceText !== "string" || entry.sourceText.trim().length === 0 || entry.sourceText.length > 300) {
        issues.push(`facts[${index}].sourceText 형식이 올바르지 않습니다.`);
      }
      if (!rangeIssue && typeof entry.sourceText === "string" && entry.sourceText.trim()) {
        facts.push({
          path,
          value: entry.value,
          sourceText: entry.sourceText.trim(),
          ...(typeof entry.observedAt === "string" ? { observedAt: entry.observedAt } : {}),
        });
      }
    });
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { expectedVersion: value.expectedVersion as number, kind: value.kind as DirectFactsRequest["kind"], facts } };
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
        const valueIssue = directValueIssue(entry.path as FactPath, entry.value);
        if (valueIssue) {
          issues.push(`changes[${index}].value: ${valueIssue}`);
          return;
        }
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
