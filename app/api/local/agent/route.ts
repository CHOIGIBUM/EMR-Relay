import { CARDIO_DEMO_PTT_UPDATES } from "@/lib/cardioDemoData";

type AgentRequest = {
  action?: unknown;
  incidentId?: unknown;
  updateId?: unknown;
  transcript?: unknown;
  locale?: unknown;
};

function normalizeBody(value: unknown): AgentRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AgentRequest;
}

export async function POST(request: Request): Promise<Response> {
  let body: AgentRequest | null = null;
  try {
    body = normalizeBody(await request.json());
  } catch {
    body = null;
  }

  const updateId = typeof body?.updateId === "string" ? body.updateId.trim() : "";
  const transcript = typeof body?.transcript === "string" ? body.transcript.normalize("NFKC").trim() : "";
  if (!updateId || !transcript || transcript.length > 4_000) {
    return Response.json(
      { error: "invalid_voice_update", message: "updateId와 1~4,000자의 transcript가 필요합니다." },
      { status: 400 },
    );
  }

  const reference = CARDIO_DEMO_PTT_UPDATES.find((update) => update.id === updateId);
  if (!reference) {
    return Response.json(
      { error: "unknown_update", message: "시연 사건에 등록되지 않은 음성 갱신입니다." },
      { status: 404 },
    );
  }

  // The local MVP only replays the matching checked fixture utterance. It must
  // not attach the fixture's clinical values to arbitrary or uninformative text.
  const exactReference = transcript === reference.transcript.normalize("NFKC").trim();
  if (!exactReference) {
    return Response.json({
      update: null,
      recognized: false,
      error: "no_structured_information",
      message: "인식 가능한 환자 상태 정보가 없어 기존 기록을 변경하지 않았습니다.",
      proposals: [],
      source: "local-structured-demo",
      writesConfirmedState: false,
      processedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 420));
  return Response.json({
    update: reference,
    recognized: true,
    source: "local-structured-demo",
    writesConfirmedState: false,
    processedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
