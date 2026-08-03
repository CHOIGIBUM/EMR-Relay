import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { AgentOutputError, createAgentProposal, getBedrockConfiguration } from "./agent.js";
import { isCaseId, validateAgentRequest, validateConfirmRequest } from "./schemas.js";
import {
  StoreConflictError,
  StoreNotFoundError,
  confirmProposal,
  getCase,
  getConfirmedState,
  getTableName,
  saveProposal,
} from "./store.js";

type JsonRecord = Record<string, unknown>;

function response(statusCode: number, body: JsonRecord): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode: number, code: string, message: string, details?: string[]) {
  return response(statusCode, {
    error: code,
    message,
    ...(details?.length ? { details } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(event: APIGatewayProxyEventV2) {
  if (!event.body) return null;
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function requestPath(event: APIGatewayProxyEventV2) {
  return event.rawPath || event.requestContext.http.path || "/";
}

function caseIdFrom(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id;
  return typeof id === "string" ? id : "";
}

function voiceContractRequest(body: Record<string, unknown>, routeCaseId: string | null) {
  const bodyCaseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
  const caseId = routeCaseId || bodyCaseId;
  if (routeCaseId && bodyCaseId && routeCaseId !== bodyCaseId) {
    return { error: "경로의 사건번호와 본문의 case_id가 일치하지 않습니다." } as const;
  }
  const updateId = typeof body.update_id === "string" ? body.update_id.trim() : "";
  const transcript = typeof body.transcript === "string" ? body.transcript.normalize("NFKC").trim() : "";
  const clientEventId = typeof body.client_event_id === "string" && body.client_event_id.trim()
    ? body.client_event_id.trim()
    : randomUUID();
  if (!caseId || !updateId || !transcript || transcript.length > 4_000) {
    return { error: "case_id, update_id와 1~4,000자의 transcript가 필요합니다." } as const;
  }
  return {
    internal: {
      caseId,
      transcript,
      source: "ptt",
      requestedBy: "PARAMEDIC_WEB",
    },
    metadata: { updateId, clientEventId, transcript },
  } as const;
}

function displayLabel(path: string) {
  const labels: Record<string, string> = {
    "patient.age": "연령",
    "patient.sex": "성별",
    "symptoms.chiefComplaint": "주호소",
    "symptoms.onsetAt": "증상 발생시각",
    "symptoms.chestPain": "흉통",
    "symptoms.associated": "동반증상",
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
    "assessment.ecg": "12유도 심전도",
    "assessment.fieldImpression": "현장 평가 소견",
    "treatment.oxygen": "산소 투여",
    "treatment.medications": "투여 약물",
    "treatment.procedures": "시행 처치",
    "transport.reassessment": "이송 중 재평가",
  };
  return labels[path] ?? path;
}

function displayProposalValue(value: unknown, unit?: string) {
  let text: string;
  if (value === null) text = "미상";
  else if (Array.isArray(value)) text = value.join(" · ");
  else if (typeof value === "boolean") text = value ? "예" : "아니오";
  else text = String(value);
  return unit ? `${text} ${unit}` : text;
}

function toVoiceProposalResponse(
  result: Awaited<ReturnType<typeof createAgentProposal>>,
  metadata: { updateId: string; clientEventId: string; transcript: string },
) {
  const { proposal } = result;
  const proposedUpdates = proposal.changes.map((change) => ({
    proposal_id: change.changeId,
    field_path: change.path,
    display_label: displayLabel(change.path),
    display_value: displayProposalValue(change.value, change.unit),
    value: change.value,
    unit: change.unit ?? null,
    fact_status: change.certainty === "unknown"
      ? "unknown"
      : change.certainty === "needs_confirmation"
        ? "unconfirmed"
        : "proposed",
    review_state: "pending_review",
    source: {
      kind: change.path === "assessment.fieldImpression" ? "paramedic_impression" : "speech_transcript",
      evidence: change.sourceText,
      observed_at: change.observedAt ?? null,
    },
  }));
  const warnings = proposal.flags.map((flag) => ({
    code: flag.code,
    severity: flag.severity === "critical" ? "error" : flag.severity,
    message: flag.message,
    field_paths: flag.field ? [flag.field] : [],
  }));
  const unknownCount = proposedUpdates.filter((item) => item.fact_status === "unknown").length;
  const attentionCount = proposedUpdates.filter((item) => item.fact_status !== "proposed").length + warnings.filter((item) => item.severity !== "info").length;

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
      message: attentionCount
        ? `변경안 ${proposedUpdates.length}건 중 ${attentionCount}건을 주의해서 확인하세요.`
        : `변경안 ${proposedUpdates.length}건을 확인한 후 반영하세요.`,
    },
    processed_at: proposal.createdAt,
    proposal_set_id: proposal.proposalId,
    base_version: proposal.baseVersion,
  };
}

async function handleAgent(event: APIGatewayProxyEventV2, routeCaseId: string | null = null) {
  const body = parseBody(event);
  if (body === undefined) return errorResponse(400, "INVALID_JSON", "요청 본문을 JSON으로 해석할 수 없습니다.");
  const usesVoiceContract = routeCaseId !== null || (isRecord(body) && ("case_id" in body || "update_id" in body));
  let metadata: { updateId: string; clientEventId: string; transcript: string } | null = null;
  let normalizedBody = body;
  if (usesVoiceContract) {
    if (!isRecord(body)) return errorResponse(400, "VALIDATION_ERROR", "음성 변경안 요청은 JSON 객체여야 합니다.");
    const normalized = voiceContractRequest(body, routeCaseId);
    if ("error" in normalized) return errorResponse(400, "VALIDATION_ERROR", normalized.error);
    normalizedBody = normalized.internal;
    metadata = normalized.metadata;
  }
  const validation = validateAgentRequest(normalizedBody);
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "음성 변경안 요청을 확인하세요.", validation.issues);

  const currentState = await getConfirmedState(validation.value.caseId);
  const { proposal, usage } = await createAgentProposal(validation.value, currentState);
  await saveProposal(proposal);

  if (metadata) return response(201, toVoiceProposalResponse({ proposal, usage }, metadata));
  return response(201, {
    proposal,
    confirmedVersion: currentState.version,
    usage,
    message: "AI 변경안입니다. 구급대원 확인 전에는 확정 환자정보에 반영되지 않습니다.",
  });
}

function handleHospitals(event: APIGatewayProxyEventV2) {
  const latitude = Number(event.queryStringParameters?.lat);
  const longitude = Number(event.queryStringParameters?.lng);
  const caseId = event.queryStringParameters?.case_id ?? "";
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return errorResponse(400, "INVALID_LOCATION", "lat과 lng에 유효한 좌표가 필요합니다.");
  }
  if (caseId && !isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "case_id 형식이 올바르지 않습니다.");

  return response(200, {
    hospitals: [
      {
        hospital_id: "demo-hongcheon-a",
        display_name: "홍천권 참고기관 A",
        care_level: "지역응급의료기관 · 시연",
        region_label: "홍천",
        distance_km: 11.4,
        eta_minutes: 16,
        reference_capabilities: ["공개 기관정보 형식", "수용 여부 아님"],
      },
      {
        hospital_id: "demo-chuncheon-b",
        display_name: "춘천권 참고기관 B",
        care_level: "지역응급의료센터 · 시연",
        region_label: "춘천",
        distance_km: 36.8,
        eta_minutes: 35,
        reference_capabilities: ["공개 시설정보 형식", "거리·ETA 시연값"],
      },
      {
        hospital_id: "demo-chuncheon-c",
        display_name: "춘천권 참고기관 C",
        care_level: "지역응급의료센터 · 시연",
        region_label: "춘천",
        distance_km: 39.2,
        eta_minutes: 38,
        reference_capabilities: ["공개 시설정보 형식", "수용 여부 아님"],
      },
    ],
    reference_at: new Date().toISOString(),
    source: "local_fixture",
  });
}

async function handleGetCase(event: APIGatewayProxyEventV2) {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  const caseView = await getCase(caseId);
  return response(200, caseView as unknown as JsonRecord);
}

async function handleConfirm(event: APIGatewayProxyEventV2) {
  const caseId = caseIdFrom(event);
  if (!isCaseId(caseId)) return errorResponse(400, "INVALID_CASE_ID", "사건번호 형식이 올바르지 않습니다.");
  const body = parseBody(event);
  if (body === undefined) return errorResponse(400, "INVALID_JSON", "요청 본문을 JSON으로 해석할 수 없습니다.");
  const validation = validateConfirmRequest(body);
  if (!validation.ok) return errorResponse(400, "VALIDATION_ERROR", "확정 요청을 확인하세요.", validation.issues);

  const result = await confirmProposal(caseId, validation.value);
  return response(200, {
    ...result,
    message: "검토 결과를 조건부 저장하고 확정 환자정보 버전을 갱신했습니다.",
  });
}

function handleHealth(context: Context) {
  const bedrock = getBedrockConfiguration();
  return response(200, {
    status: "ok",
    service: "ems-relay-backend",
    requestId: context.awsRequestId,
    region: process.env.AWS_REGION ?? "local",
    bedrock: { region: bedrock.region, configured: Boolean(bedrock.modelId) },
    storage: { table: getTableName() },
    time: new Date().toISOString(),
  });
}

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  const path = requestPath(event);

  if (method === "OPTIONS") return response(204, {});

  try {
    if (method === "GET" && path === "/health") return handleHealth(context);
    if (method === "POST" && path === "/agent") return await handleAgent(event);
    if (method === "POST" && /^\/cases\/[^/]+\/voice-updates\/proposals$/.test(path)) return await handleAgent(event, caseIdFrom(event));
    if (method === "GET" && path === "/hospitals") return handleHospitals(event);
    if (method === "GET" && /^\/cases\/[^/]+$/.test(path)) return await handleGetCase(event);
    if (method === "POST" && /^\/cases\/[^/]+\/confirm$/.test(path)) return await handleConfirm(event);
    return errorResponse(404, "NOT_FOUND", "요청한 API 경로를 찾지 못했습니다.");
  } catch (error) {
    if (error instanceof StoreNotFoundError) return errorResponse(404, "NOT_FOUND", error.message);
    if (error instanceof StoreConflictError) return errorResponse(409, "VERSION_CONFLICT", error.message);
    if (error instanceof AgentOutputError) return errorResponse(502, "INVALID_AGENT_OUTPUT", error.message, error.issues);

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(JSON.stringify({
      level: "error",
      requestId: context.awsRequestId,
      method,
      path,
      errorName,
      errorMessage,
    }));

    if (errorMessage.includes("INVALID_PAYMENT_INSTRUMENT") || /payment instrument/i.test(errorMessage)) {
      return errorResponse(503, "BEDROCK_BILLING_NOT_READY", "Bedrock 결제 수단 확인이 필요해 AI 변경안을 생성할 수 없습니다. 로컬 시연 모드를 사용하세요.");
    }
    if (
      errorName === "AccessDeniedException"
      && /model access|marketplace|subscription/i.test(errorMessage)
    ) {
      return errorResponse(
        503,
        "BEDROCK_MODEL_ACCESS_NOT_READY",
        "Anthropic 모델 사용 등록이 완료되지 않아 AI 변경안을 생성할 수 없습니다. AWS 계정 관리자가 모델 접근 및 결제 설정을 확인해야 합니다.",
      );
    }
    if (["ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException"].includes(errorName)) {
      return errorResponse(503, "AGENT_TEMPORARILY_UNAVAILABLE", "AI 변경안 생성이 지연되고 있습니다. 잠시 후 다시 시도하세요.");
    }
    return errorResponse(500, "INTERNAL_ERROR", "요청을 처리하지 못했습니다.");
  }
}
