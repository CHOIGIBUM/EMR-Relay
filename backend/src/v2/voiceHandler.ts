import { requireRole } from "../auth.js";
import { saveProposal, getConfirmedState } from "../store.js";
import { createTranscribeSession as createStreamingSession } from "../transcribeSession.js";
import { assertCaseAccess } from "../workflowStore.js";
import { principalFromAppSyncIdentity, type AppSyncIdentity } from "./appsyncIdentity.js";
import { createV2VoiceProposal, type VoiceFocus } from "./voiceAgent.js";

type ResolverEvent = {
  field: string;
  arguments?: Record<string, unknown>;
  identity?: AppSyncIdentity;
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FOCUS_VALUES = new Set<VoiceFocus>(["BASIC", "CPSS", "VITALS"]);

function requiredId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function requiredInput(event: ResolverEvent) {
  const input = event.arguments?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input은 객체여야 합니다.");
  return input as Record<string, unknown>;
}

export function validateVoiceProposalInput(input: Record<string, unknown>) {
  const caseId = requiredId(input.caseId, "caseId");
  if (typeof input.transcript !== "string" || !input.transcript.trim() || input.transcript.length > 10_000) {
    throw new Error("인식 문장은 1~10,000자로 입력해 주세요.");
  }
  const focus = (input.focus ?? "VITALS") as VoiceFocus;
  if (!FOCUS_VALUES.has(focus)) throw new Error("음성 입력 범위를 확인해 주세요.");
  const observedAt = input.observedAt;
  if (observedAt !== undefined && (typeof observedAt !== "string" || !ISO_DATE_PATTERN.test(observedAt))) {
    throw new Error("측정 시각 형식을 확인해 주세요.");
  }
  return { caseId, transcript: input.transcript.trim(), focus, ...(typeof observedAt === "string" ? { observedAt } : {}) };
}

async function createTranscribeSession(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  const caseId = requiredId(requiredInput(event).caseId, "caseId");
  await assertCaseAccess(principal, caseId);
  return createStreamingSession(caseId, principal);
}

async function structureVoiceUpdate(event: ResolverEvent) {
  const principal = principalFromAppSyncIdentity(event.identity);
  requireRole(principal, "paramedic");
  const input = validateVoiceProposalInput(requiredInput(event));
  await assertCaseAccess(principal, input.caseId);
  const state = await getConfirmedState(input.caseId);
  const result = await createV2VoiceProposal({ ...input, requestedBy: principal.sub }, state);
  await saveProposal(result.proposal);
  return {
    proposalId: result.proposal.proposalId,
    caseId: result.proposal.caseId,
    baseVersion: result.proposal.baseVersion,
    status: result.proposal.status,
    summary: result.proposal.summary,
    changes: JSON.stringify(result.proposal.changes),
    flags: JSON.stringify(result.proposal.flags),
    createdAt: result.proposal.createdAt,
    requiresHumanReview: true,
  };
}

export async function handler(event: ResolverEvent) {
  switch (event.field) {
    case "createTranscribeSession": return createTranscribeSession(event);
    case "structureVoiceUpdate": return structureVoiceUpdate(event);
    default: throw new Error(`지원하지 않는 음성 AppSync field입니다: ${event.field}`);
  }
}
