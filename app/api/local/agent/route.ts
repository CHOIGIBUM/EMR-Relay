import type {
  AvpuValue,
  CpssSideValue,
  CpssSpeechValue,
  LocalAgentResponse,
  LocalAgentStructuredResult,
  LocalFieldMetadata,
} from "@/lib/localDemoTypes";

type ExtractedValue<T> = {
  value: T;
  metadata: LocalFieldMetadata;
};

const DEFAULT_RESULT: LocalAgentStructuredResult = {
  avpu: "A",
  face: "우측",
  arm: "우측",
  speech: "어눌함",
  lnt: "13:40",
  fat: "14:15",
};

function hashTranscript(transcript: string): number {
  let hash = 2166136261;

  for (const character of transcript) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function makeFallback<T>(value: T): ExtractedValue<T> {
  return {
    value,
    metadata: {
      source: "demo-fallback",
      needsReview: true,
      evidence: null,
    },
  };
}

function makeTranscriptValue<T>(value: T, evidence: string): ExtractedValue<T> {
  return {
    value,
    metadata: {
      source: "transcript",
      needsReview: false,
      evidence: evidence.trim(),
    },
  };
}

function findEvidence(transcript: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(transcript);
    if (match) return match[0];
  }

  return null;
}

function extractAvpu(transcript: string): ExtractedValue<AvpuValue> {
  const candidates: Array<{ value: AvpuValue; patterns: RegExp[] }> = [
    { value: "U", patterns: [/무반응|AVPU\s*U|unresponsive/i] },
    { value: "P", patterns: [/통증(?:에만)?\s*반응|AVPU\s*P/i] },
    { value: "V", patterns: [/(?:음성|부르면|말에)\s*반응|AVPU\s*V/i] },
    {
      value: "A",
      patterns: [/의식\s*(?:명료|깨어\s*있음)|명료함|AVPU\s*A|alert/i],
    },
  ];

  for (const candidate of candidates) {
    const evidence = findEvidence(transcript, candidate.patterns);
    if (evidence) return makeTranscriptValue(candidate.value, evidence);
  }

  return makeFallback(DEFAULT_RESULT.avpu);
}

function extractSide(
  transcript: string,
  subject: "face" | "arm",
): ExtractedValue<CpssSideValue> {
  const target = subject === "face" ? "(?:얼굴|안면)" : "(?:팔|상지)";
  const makePattern = (side: string) => [
    new RegExp(`(?:${side})[^.!?\\n]{0,18}${target}`, "i"),
    new RegExp(`${target}[^.!?\\n]{0,18}(?:${side})`, "i"),
  ];
  const candidates: Array<{ value: CpssSideValue; patterns: RegExp[] }> = [
    { value: "우측", patterns: makePattern("우측|오른쪽") },
    { value: "좌측", patterns: makePattern("좌측|왼쪽") },
    {
      value: "정상",
      patterns: [
        new RegExp(`${target}[^.!?\\n]{0,14}(?:정상|대칭|위약\s*없음|처짐\s*없음)`, "i"),
        new RegExp(`(?:정상|대칭)[^.!?\\n]{0,14}${target}`, "i"),
      ],
    },
    {
      value: "평가 불가",
      patterns: [new RegExp(`${target}[^.!?\\n]{0,14}평가\s*불가`, "i")],
    },
  ];

  for (const candidate of candidates) {
    const evidence = findEvidence(transcript, candidate.patterns);
    if (evidence) return makeTranscriptValue(candidate.value, evidence);
  }

  return makeFallback(DEFAULT_RESULT[subject]);
}

function extractSpeech(transcript: string): ExtractedValue<CpssSpeechValue> {
  const candidates: Array<{ value: CpssSpeechValue; patterns: RegExp[] }> = [
    {
      value: "표현 곤란",
      patterns: [/표현\s*곤란|실어증?|말을\s*못\s*(?:함|해|합니다)/i],
    },
    {
      value: "어눌함",
      patterns: [/말(?:이|은)?\s*(?:어눌|잘\s*안\s*나옴)|구음장애|발음(?:이|은)?\s*어눌/i],
    },
    {
      value: "정상",
      patterns: [/말하기\s*정상|발음\s*정상|언어\s*정상/i],
    },
    {
      value: "평가 불가",
      patterns: [/(?:말하기|언어|구음)[^.!?\n]{0,12}평가\s*불가/i],
    },
  ];

  for (const candidate of candidates) {
    const evidence = findEvidence(transcript, candidate.patterns);
    if (evidence) return makeTranscriptValue(candidate.value, evidence);
  }

  return makeFallback(DEFAULT_RESULT.speech);
}

function extractTime(
  transcript: string,
  labelPattern: string,
  fallback: string,
): ExtractedValue<string> {
  const pattern = new RegExp(
    `(?:${labelPattern})\\s*(?:은|는|이|가|:)?\\s*(\\d{1,2})\\s*(?::|시)\\s*(\\d{1,2})?\\s*분?`,
    "i",
  );
  const match = pattern.exec(transcript);

  if (!match) return makeFallback(fallback);

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour > 23 || minute > 59) return makeFallback(fallback);

  return makeTranscriptValue(
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    match[0],
  );
}

async function readTranscript(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("transcript" in body)) return null;

    const transcript = (body as { transcript?: unknown }).transcript;
    if (typeof transcript !== "string") return null;

    const normalized = transcript.normalize("NFKC").trim();
    return normalized.length > 0 && normalized.length <= 4_000 ? normalized : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const transcript = await readTranscript(request);
  if (!transcript) {
    return Response.json(
      {
        error: "invalid_transcript",
        message: "transcript는 1자 이상 4,000자 이하의 문자열이어야 합니다.",
      },
      { status: 400 },
    );
  }

  const hash = hashTranscript(transcript);
  const processingDelayMs = 300 + (hash % 301);
  await new Promise<void>((resolve) => setTimeout(resolve, processingDelayMs));

  const extracted = {
    avpu: extractAvpu(transcript),
    face: extractSide(transcript, "face"),
    arm: extractSide(transcript, "arm"),
    speech: extractSpeech(transcript),
    lnt: extractTime(
      transcript,
      "LNT|마지막\\s*정상(?:\\s*확인)?(?:\\s*시각)?",
      DEFAULT_RESULT.lnt,
    ),
    fat: extractTime(
      transcript,
      "FAT|최초\\s*이상\\s*발견(?:\\s*시각)?|처음\\s*발견(?:\\s*시각)?",
      DEFAULT_RESULT.fat,
    ),
  } satisfies Record<keyof LocalAgentStructuredResult, ExtractedValue<unknown>>;

  const structured: LocalAgentStructuredResult = {
    avpu: extracted.avpu.value,
    face: extracted.face.value,
    arm: extracted.arm.value,
    speech: extracted.speech.value,
    lnt: extracted.lnt.value,
    fat: extracted.fat.value,
  };
  const fieldMeta = {
    avpu: extracted.avpu.metadata,
    face: extracted.face.metadata,
    arm: extracted.arm.metadata,
    speech: extracted.speech.metadata,
    lnt: extracted.lnt.metadata,
    fat: extracted.fat.metadata,
  } satisfies LocalAgentResponse["fieldMeta"];

  const response: LocalAgentResponse = {
    transcript,
    structured,
    fieldMeta,
    source: "local-deterministic-agent",
    needsReview: Object.values(fieldMeta).some((field) => field.needsReview),
    processedAt: new Date().toISOString(),
    processingDelayMs,
    requestId: `local-agent-${hash.toString(16).padStart(8, "0")}`,
  };

  return Response.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
