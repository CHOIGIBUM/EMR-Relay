export type AvpuValue = "A" | "V" | "P" | "U";

export type CpssSideValue = "정상" | "좌측" | "우측" | "평가 불가";
export type CpssSpeechValue = "정상" | "어눌함" | "표현 곤란" | "평가 불가";
export type LocalFieldSource = "transcript" | "demo-fallback";

export type LocalAgentStructuredResult = {
  avpu: AvpuValue;
  face: CpssSideValue;
  arm: CpssSideValue;
  speech: CpssSpeechValue;
  lnt: string;
  fat: string;
};

export type LocalFieldMetadata = {
  source: LocalFieldSource;
  needsReview: boolean;
  evidence: string | null;
};

export type LocalAgentResponse = {
  transcript: string;
  structured: LocalAgentStructuredResult;
  fieldMeta: Record<keyof LocalAgentStructuredResult, LocalFieldMetadata>;
  source: "local-deterministic-agent";
  needsReview: boolean;
  processedAt: string;
  processingDelayMs: number;
  requestId: string;
};

export type LocalHospitalCandidate = {
  id: string;
  name: string;
  type: string;
  distance: string;
  eta: string;
  location: string;
  reference: string[];
};

export type LocalHospitalsResponse = {
  hospitals: LocalHospitalCandidate[];
  dataSource: "local-demo-fixture";
  referenceTimestamp: string;
};

export type LocalServiceState = {
  status: "available";
  provider: string;
};

export type LocalHealthResponse = {
  status: "ok";
  mode: "local-mock";
  services: {
    agent: LocalServiceState;
    hospitals: LocalServiceState;
    persistence: LocalServiceState;
  };
  checkedAt: string;
};
