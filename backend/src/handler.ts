import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { AgentOutputError, createAgentProposal, getBedrockConfiguration } from "./agent.js";
import {
  AuthenticationError,
  AuthorizationError,
  authorizeCommand,
  principalFromEvent,
  requireRole,
} from "./auth.js";
import { publishFinalizedReport } from "./fhir.js";
import { getHospitalReferences } from "./external/hospitalReferenceService.js";
import { getLiveRouteReference, validateRouteReferenceRequest } from "./external/routeReferenceService.js";
import { createRealtimeTicket } from "./realtimeStore.js";
import {
  createReportDraft,
  finalizeReport,
  getLatestReport,
  reviewReport,
} from "./reportStore.js";
import { isCaseId, validateAgentRequest, validateConfirmRequest, validateDirectFactsRequest } from "./schemas.js";
import {
  confirmProposal,
  getCase,
  getConfirmedState,
  getTableName,
  saveAndConfirmDirectFacts,
  saveProposal,
  StoreConflictError,
  StoreNotFoundError,
} from "./store.js";
import { createTranscribeSession } from "./transcribeSession.js";
import type { AuthPrincipal, FactPath } from "./types.js";
import {
  assertCaseAccess,
  executeCaseCommand,
  getWorkflowCase,
} from "./workflowStore.js";
import { isRecord, validateCaseCommand, validateTranscribeSession } from "./workflowSchemas.js";

type JsonRecord = Record<string, unknown>;

function response(statusCode: number, body: JsonRecord): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode: number, code: string, message: string, details?: string[]) {
  return response(statusCode, { error: { code, message, ...(details?.length ? { details } : {}) } });
}

function parseBody(event: APIGatewayProxyEventV2): unknown | undefined {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function path(event: APIGatewayProxyEventV2) {
  return event.rawPath || event.requestContext.http.path;
}

function caseIdFrom(event: APIGatewayProxyEventV2) {
  return event.pathParameters?.id?.trim() ?? "";
}

function routeRequestId(event: APIGatewayProxyEventV2) {
  return event.pathParameters?.requestId?.trim() ?? "";
}

function phaseForVoiceUpdate(updateId: string) {
  if (/-U04$/i.test(updateId)) return "reassessment" as const;
  if (/-U0[1-3]$/i.test(updateId)) return "scene" as const;
  return undefined;
}

function normalizeAgentBody(body: unknown, principal: AuthPrincipal, routeCaseId?: string) {
  if (!isRecord(body)) return body;
  if (routeCaseId || "case_id" in body || "update_id" in body) {
    const bodyCaseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
    if (routeCaseId && bodyCaseId && routeCaseId !== bodyCaseId) return { error: "경로와 본문의 사건번호가 일치하지 않습니다." };
    const caseId = routeCaseId || bodyCaseId;
    const updateId = typeof body.update_id === "string" ? body.update_id.trim() : "";
    const transcript = typeof body.transcript === "string" ? body.transcript.normalize("NFKC").trim() : "";
    const clientEventId = typeof body.client_event_id === "string" && body.client_event_id.trim() ? body.client_event_id.trim() : updateId;
    return {
      internal: {
        caseId,
        transcript,
        observedAt: typeof body.observed_at === "string" ? body.observed_at : undefined,
        source: "ptt",
        requestedBy: principal.sub,
        updateId,
        phase: phaseForVoiceUpdate(updateId),
      },
      metadata: { updateId, clientEventId, transcript },
    };
  }
  return { internal: { ...body, requestedBy: principal.sub }, metadata: null };
}

const DISPLAY_LABELS: Record<FactPath, string> = {
  "patient.age": "나이",
  "patient.sex": "성별",
  "symptoms.chiefComplaint": "주호소",
  "symptoms.onsetAt": "증상 발생 시각",
  "symptoms.chestPain": "흉통",
  "symptoms.chestPainNrs": "흉통 NRS",
  "symptoms.chestPainQuality": "흉통 양상",
  "symptoms.chestPainRadiation": "방사통",
  "symptoms.associated": "동반 증상",
  "consciousness.avpu": "의식 수준(AVPU)",
  "vitals.systolicBp": "수축기혈압",
  "vitals.diastolicBp": "이완기혈압",
  "vitals.pulse": "맥박",
  "vitals.respiratoryRate": "호흡수",
  "vitals.spo2": "산소포화도",
  "vitals.temperature": "체온",
  "vitals.glucose": "혈당",
  "history.conditions": "과거력",
  "history.medications": "복용약",
  "history.allergies": "알레르기",
  "assessment.airway": "A · 기도",
  "assessment.breathing": "B · 호흡",
  "assessment.circulation": "C · 순환",
  "assessment.ecg": "12유도 심전도",
  "assessment.fieldImpression": "현장 평가 소견",
  "treatment.oxygen": "산소 투여",
  "treatment.medications": "투여 약물",
  "treatment.procedures": "시행 처치",
  "reassessment.systolicBp": "재평가 수축기혈압",
  "reassessment.diastolicBp": "재평가 이완기혈압",
  "reassessment.pulse": "재평가 맥박",
  "reassessment.respiratoryRate": "재평가 호흡수",
  "reassessment.spo2": "재평가 산소포화도",
  "reassessment.temperature": "재평가 체온",
  "reassessment.glucose": "재평가 혈당",
  "reassessment.avpu": "재평가 의식 수준(AVPU)",
  "transport.reassessment": "이송 중 재평가",
};

function displayValue(value: unknown, unit?: string) {
  const text = value === null ? "미상" : Array.isArray(value) ? value.join(" · ") : typeof value === "boolean" ? value ? "예" : "아니요" : String(value);
  return unit ? `${text} ${unit}` : text;
}

type VoiceReviewUpdate = {
  field_path: string;
  fact_status: string;
};

type VoiceReviewWarning = {
  code: string;
  severity: string;
  field_paths: string[];
};

/**
 * Counts actionable review targets rather than adding candidate and warning
 * rows. A warning for an already-unconfirmed field is therefore counted once;
 * warning codes without a field remain independently actionable.
 */
export function actionableAttentionCount(
  proposedUpdates: readonly VoiceReviewUpdate[],
  warnings: readonly VoiceReviewWarning[],
) {
  const targets = new Set<string>();
  for (const update of proposedUpdates) {
    if (update.fact_status !== "proposed") targets.add(`field:${update.field_path}`);
  }
  for (const warning of warnings) {
    if (warning.severity === "info") continue;
    if (warning.field_paths.length) {
      for (const fieldPath of warning.field_paths) targets.add(`field:${fieldPath}`);
    } else {
      targets.add(`code:${warning.code}`);
    }
  }
  return targets.size;
}

function voiceResponse(
  result: Awaited<ReturnType<typeof createAgentProposal>>,
  metadata: { updateId: string; clientEventId: string; transcript: string },
) {
  const { proposal } = result;
  const proposedUpdates = proposal.changes.map((change) => ({
    proposal_id: change.changeId,
    field_path: change.path,
    display_label: DISPLAY_LABELS[change.path],
    display_value: displayValue(change.value, change.unit),
    value: change.value,
    unit: change.unit ?? null,
    fact_status: change.certainty === "unknown" ? "unknown" : change.certainty === "needs_confirmation" ? "unconfirmed" : "proposed",
    review_state: "pending_review",
    source: {
      kind: change.path === "assessment.fieldImpression" ? "paramedic_impression" : "speech_transcript",
      evidence: change.sourceText,
      observed_at: change.observedAt ?? null,
    },
  }));
  const warnings: VoiceReviewWarning[] = proposal.flags.map((flag) => ({
    code: flag.code,
    severity: flag.severity === "critical" ? "error" : flag.severity as VoiceReviewWarning["severity"],
    message: flag.message,
    field_paths: flag.field ? [flag.field] : [],
  }));
  const unknownCount = proposedUpdates.filter((item) => item.fact_status === "unknown").length;
  const attentionCount = actionableAttentionCount(proposedUpdates, warnings);
  return {
    request_id: metadata.clientEventId,
    case_id: proposal.caseId,
    update_id: metadata.updateId,
    transcript: metadata.transcript,
    pending_review: true,
    proposed_updates: proposedUpdates,
    warnings,
    review_summary: {
      total_count: proposedUpdates.length,
      confirmable_count: proposedUpdates.length - unknownCount,
      attention_count: attentionCount,
      unknown_count: unknownCount,
      message: attentionCount ? `변경안 ${proposedUpdates.length}건 · 확인 필요 ${attentionCount}건` : `변경안 ${proposedUpdates.length}건을 확인한 뒤 반영하세요.`,
    },
    processed_at: proposal.createdAt,
    proposal_set_id: proposal.proposalId,
    base_version: proposal.baseVersion,
  };
}

async function handleAgent(event: APIGatewayProxyEventV2, principal: AuthPrincipal, routeCaseId?: string) {
  requireRole(principal, "paramedic");
  const body = parseBody(event);
  if (body === undefined) return errorResponse(400, "INVALID_JSON", "요청 본문을 JSON으로 해석할 수 없습니다.");
  const normalized = normalizeAgentBody(body, principal, routeCaseId);
  if (isRecord(normalized) && typeof normalized.error === "string") return errorResponse(400, "CASE_BINDING_MISMATCH", normalized.error);
  if (!isRecord(normalized) || !("internal" in normalized)) return errorResponse(400, "VALIDATION_ERROR", "음성 변경안 요청을 확인하세요.");
  const validation = validateAgentRequest(normalized.internal);
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "음성 변경안 요청을 확인하세요.", validation.issues);
  await assertCaseAccess(principal, validation.value.caseId);
  const currentState = await getConfirmedState(validation.value.caseId);
  const result = await createAgentProposal(validation.value, currentState);
  await saveProposal(result.proposal);
  const metadata = normalized.metadata as { updateId: string; clientEventId: string; transcript: string } | null;
  return metadata
    ? response(201, voiceResponse(result, metadata))
    : response(201, { proposal: result.proposal, confirmedVersion: currentState.version, usage: result.usage, message: "AI 변경안은 구급대원 확인 전까지 확정 정보에 반영되지 않습니다." });
}

async function handleHospitals(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  const latitude = Number(event.queryStringParameters?.lat);
  const longitude = Number(event.queryStringParameters?.lng);
  const caseId = event.queryStringParameters?.case_id ?? "";
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return errorResponse(400, "INVALID_LOCATION", "lat과 lng에 유효한 좌표가 필요합니다.");
  }
  if (caseId && !isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  if (caseId) await assertCaseAccess(principal, caseId);
  const directory = await getHospitalReferences(latitude, longitude);
  return response(200, directory as unknown as JsonRecord);
}

async function handleRoute(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  requireRole(principal, "paramedic", "control");
  const body = parseBody(event);
  if (body === undefined) return errorResponse(400, "INVALID_JSON", "요청 본문을 JSON으로 해석할 수 없습니다.");
  const validation = validateRouteReferenceRequest(body);
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "경로 조회 요청을 확인해 주세요.", validation.issues);
  if (!isCaseId(validation.value.caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  await assertCaseAccess(principal, validation.value.caseId);
  return response(
    200,
    await getLiveRouteReference(validation.value.origin, validation.value.destination) as unknown as JsonRecord,
  );
}

async function handleGetCase(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  await assertCaseAccess(principal, caseId);
  const [base, workflow, report] = await Promise.all([getCase(caseId), getWorkflowCase(caseId), getLatestReport(caseId)]);
  const hospitalOnly = principal.roles.includes("hospital")
    && !principal.roles.some((role) => role === "admin" || role === "control" || role === "paramedic");
  if (hospitalOnly && principal.hospitalId) {
    const ownRequests = workflow.hospitalRequests.filter((request) => request.hospitalId === principal.hospitalId);
    const ownRequestIds = new Set(ownRequests.map((request) => request.requestId));
    const requestScopedTypes = new Set([
      "HOSPITAL_REQUEST_CREATED",
      "HOSPITAL_REQUEST_VIEWED",
      "ADDITIONAL_INFO_REQUESTED",
      "ADDITIONAL_INFO_SENT",
      "HOSPITAL_RESPONSE_RECORDED",
      "DESTINATION_CONFIRMED_BY_PARAMEDIC",
      "HANDOFF_ACCEPTED",
    ]);
    const visibleEvents = workflow.events.filter((item) => {
      if (!requestScopedTypes.has(item.type)) return [
        "PATIENT_FACTS_CONFIRMED",
        "TRANSPORT_STARTED",
        "REASSESSMENT_CONFIRMED",
        "ARRIVED_HOSPITAL",
        "HANDOFF_SENT",
      ].includes(item.type);
      const requestId = typeof item.payload.requestId === "string" ? item.payload.requestId : "";
      return ownRequestIds.has(requestId);
    });
    const safeMeta = workflow.meta ? { ...workflow.meta, assignedParamedicIds: [] } : undefined;
    return response(200, {
      caseId: base.caseId,
      confirmedState: base.confirmedState,
      proposals: [],
      audit: [],
      ...(safeMeta ? { meta: safeMeta } : {}),
      events: visibleEvents,
      hospitalRequests: ownRequests,
    } as unknown as JsonRecord);
  }
  return response(200, { ...base, ...workflow, ...(report ? { report } : {}) } as unknown as JsonRecord);
}

async function handleConfirm(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  requireRole(principal, "paramedic");
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  await assertCaseAccess(principal, caseId);
  const body = parseBody(event);
  if (!isRecord(body)) return errorResponse(400, "INVALID_JSON", "요청 본문을 JSON으로 해석할 수 없습니다.");
  const validation = validateConfirmRequest({ ...body, reviewedBy: principal.sub });
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "확정 요청을 확인하세요.", validation.issues);
  const result = await confirmProposal(
    caseId,
    validation.value,
    principal.roles.includes("admin") ? "admin" : "paramedic",
  );
  return response(200, { ...result, message: "검토 결과를 저장하고 확정 환자정보를 갱신했습니다." } as unknown as JsonRecord);
}

async function handleDirectFacts(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  requireRole(principal, "paramedic");
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  await assertCaseAccess(principal, caseId);
  const validation = validateDirectFactsRequest(parseBody(event));
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "직접 입력값을 확인하세요.", validation.issues);
  const result = await saveAndConfirmDirectFacts(
    caseId,
    validation.value,
    principal.sub,
    principal.roles.includes("admin") ? "admin" : "paramedic",
  );
  return response(200, { ...result, message: "직접 확인한 환자정보를 저장했습니다." } as unknown as JsonRecord);
}

async function handleCommand(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  const body = parseBody(event);
  const validation = validateCaseCommand(body);
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "사건 명령을 확인하세요.", validation.issues);
  authorizeCommand(principal, validation.value.type);
  if (validation.value.type !== "CASE_ASSIGNED") await assertCaseAccess(principal, caseId);
  const result = await executeCaseCommand(caseId, validation.value, principal);
  return response(200, result as unknown as JsonRecord);
}

async function handleRealtimeSession(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  await assertCaseAccess(principal, caseId);
  return response(201, await createRealtimeTicket(caseId, principal));
}

async function handleTranscribeSession(event: APIGatewayProxyEventV2, principal: AuthPrincipal) {
  requireRole(principal, "paramedic");
  const validation = validateTranscribeSession(parseBody(event));
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "음성 인식 세션 요청을 확인하세요.", validation.issues);
  await assertCaseAccess(principal, validation.value.caseId);
  return response(201, await createTranscribeSession(validation.value.caseId, principal));
}

async function handleReport(event: APIGatewayProxyEventV2, principal: AuthPrincipal, action: "get" | "draft" | "review" | "finalize") {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  if (action === "get") {
    requireRole(principal, "paramedic", "control");
    await assertCaseAccess(principal, caseId);
    const report = await getLatestReport(caseId);
    if (!report) throw new StoreNotFoundError("보고서를 찾을 수 없습니다.");
    return response(200, { report } as unknown as JsonRecord);
  }
  if (action === "draft") return response(201, { report: await createReportDraft(caseId, principal) } as unknown as JsonRecord);
  if (action === "finalize") {
    const report = await finalizeReport(caseId, principal);
    const fhir = process.env.HEALTHLAKE_DATASTORE_ENDPOINT
      ? { status: "QUEUED", message: "FHIR 변환·저장 작업을 안전한 재시도 대기열에 등록했습니다." }
      : { status: "NOT_CONFIGURED", message: "HealthLake 연결이 설정되지 않아 보고서만 확정했습니다." };
    return response(200, { report, fhir } as unknown as JsonRecord);
  }
  const body = parseBody(event);
  if (!isRecord(body) || !Array.isArray(body.reviewedFields) || body.reviewedFields.some((value) => typeof value !== "string")) {
    return errorResponse(400, "VALIDATION_ERROR", "reviewedFields 문자열 배열이 필요합니다.");
  }
  return response(200, { report: await reviewReport(caseId, principal, body.reviewedFields as string[]) } as unknown as JsonRecord);
}

function handleHealth(context: Context) {
  const bedrock = getBedrockConfiguration();
  return response(200, {
    status: "ok",
    service: "ems-relay-backend",
    requestId: context.awsRequestId,
    region: process.env.AWS_REGION ?? "local",
    agent: bedrock,
    storage: { table: getTableName() },
    audioStorage: "disabled",
    time: new Date().toISOString(),
  });
}

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  const requestPath = path(event);
  if (method === "OPTIONS") return response(204, {});
  try {
    if (method === "GET" && requestPath === "/health") return handleHealth(context);
    const principal = principalFromEvent(event);
    if (method === "POST" && requestPath === "/agent") return await handleAgent(event, principal);
    if (method === "POST" && /^\/cases\/[^/]+\/voice-updates\/proposals$/.test(requestPath)) return await handleAgent(event, principal, caseIdFrom(event));
    if (method === "GET" && requestPath === "/hospitals") return await handleHospitals(event, principal);
    if (method === "POST" && requestPath === "/route") return await handleRoute(event, principal);
    if (method === "GET" && /^\/cases\/[^/]+$/.test(requestPath)) return await handleGetCase(event, principal);
    if (method === "POST" && /^\/cases\/[^/]+\/confirm$/.test(requestPath)) return await handleConfirm(event, principal);
    if (method === "POST" && /^\/cases\/[^/]+\/direct-facts$/.test(requestPath)) return await handleDirectFacts(event, principal);
    if (method === "POST" && /^\/cases\/[^/]+\/commands$/.test(requestPath)) return await handleCommand(event, principal);
    if (method === "POST" && /^\/cases\/[^/]+\/realtime-session$/.test(requestPath)) return await handleRealtimeSession(event, principal);
    if (method === "POST" && requestPath === "/transcribe/session") return await handleTranscribeSession(event, principal);
    if (method === "GET" && /^\/cases\/[^/]+\/report$/.test(requestPath)) return await handleReport(event, principal, "get");
    if (method === "POST" && /^\/cases\/[^/]+\/report\/draft$/.test(requestPath)) return await handleReport(event, principal, "draft");
    if (method === "POST" && /^\/cases\/[^/]+\/report\/review$/.test(requestPath)) return await handleReport(event, principal, "review");
    if (method === "POST" && /^\/cases\/[^/]+\/report\/finalize$/.test(requestPath)) return await handleReport(event, principal, "finalize");
    if (method === "POST" && /^\/cases\/[^/]+\/fhir\/publish$/.test(requestPath)) {
      if (!isCaseId(caseIdFrom(event))) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
      return response(200, await publishFinalizedReport(caseIdFrom(event), principal) as unknown as JsonRecord);
    }
    if (routeRequestId(event)) return errorResponse(404, "NOT_FOUND", "요청 경로를 찾지 못했습니다.");
    return errorResponse(404, "NOT_FOUND", "요청 경로를 찾지 못했습니다.");
  } catch (error) {
    if (error instanceof AuthenticationError) return errorResponse(401, "UNAUTHENTICATED", error.message);
    if (error instanceof AuthorizationError) return errorResponse(403, "FORBIDDEN", error.message);
    if (error instanceof StoreNotFoundError) return errorResponse(404, "NOT_FOUND", error.message);
    if (error instanceof StoreConflictError) return errorResponse(409, "VERSION_CONFLICT", error.message);
    if (error instanceof AgentOutputError) return errorResponse(502, "INVALID_AGENT_OUTPUT", error.message, error.issues);
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    // Do not log exception messages because upstream services can echo clinical payloads.
    console.error(JSON.stringify({ level: "error", requestId: context.awsRequestId, method, path: requestPath, errorName }));
    if (errorMessage.includes("INVALID_PAYMENT_INSTRUMENT") || /payment instrument/i.test(errorMessage)) return errorResponse(503, "BEDROCK_BILLING_NOT_READY", "Bedrock 결제 수단 확인이 필요합니다.");
    if (errorMessage === "HEALTHLAKE_NOT_CONFIGURED") return errorResponse(503, "HEALTHLAKE_NOT_CONFIGURED", "HealthLake 데이터 저장소가 설정되지 않았습니다.");
    if (errorName === "AccessDeniedException" && /model access|marketplace|subscription/i.test(errorMessage)) return errorResponse(503, "BEDROCK_MODEL_ACCESS_NOT_READY", "Anthropic 모델 사용 등록을 확인하세요.");
    if (["ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException"].includes(errorName)) return errorResponse(503, "TEMPORARILY_UNAVAILABLE", "서비스가 일시적으로 지연되고 있습니다.");
    return errorResponse(500, "INTERNAL_ERROR", "요청을 처리하지 못했습니다.");
  }
}
