import { EMS_API_CONFIG, EmsApiError } from "@/lib/emsApi";
import { currentAccessToken } from "@/lib/cognitoAuth";
import type {
  CaseCommandRequest,
  CaseCommandResponse,
  CaseRealtimeMessage,
  OperationalCaseSnapshot,
  RealtimeSessionResponse,
  TranscribeSessionRequest,
  TranscribeSessionResponse,
} from "@/lib/operationalTypes";

export const OPERATIONAL_CONFIG = Object.freeze({
  enabled: process.env.NEXT_PUBLIC_EMS_OPERATIONAL_MODE === "remote",
  allowDevelopmentFallback: process.env.NEXT_PUBLIC_EMS_ALLOW_DEVELOPMENT_FALLBACK === "true",
  scriptedPtt: process.env.NEXT_PUBLIC_EMS_SCRIPTED_PTT === "true",
});

function endpoint(path: string) {
  if (!EMS_API_CONFIG.remoteBase) throw new EmsApiError("서버 주소가 설정되지 않았습니다.", { code: "API_BASE_NOT_CONFIGURED" });
  return `${EMS_API_CONFIG.remoteBase}/${path.replace(/^\/+/, "")}`;
}

async function authorizedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await currentAccessToken();
  const response = await fetch(endpoint(path), {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const nested = payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : null;
    const message = nested && typeof nested.message === "string"
      ? nested.message
      : payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `요청을 처리하지 못했습니다. (${response.status})`;
    throw new EmsApiError(message, { status: response.status, code: "OPERATIONAL_API_ERROR" });
  }
  return payload as T;
}

export function getCaseSnapshot(caseId: string, signal?: AbortSignal) {
  return authorizedJson<OperationalCaseSnapshot>(`cases/${encodeURIComponent(caseId)}`, { signal });
}

export function submitCaseCommand(caseId: string, command: CaseCommandRequest, signal?: AbortSignal) {
  return authorizedJson<CaseCommandResponse>(`cases/${encodeURIComponent(caseId)}/commands`, {
    method: "POST",
    body: JSON.stringify(command),
    signal,
  });
}

export function createTranscribeSession(input: TranscribeSessionRequest, signal?: AbortSignal) {
  return authorizedJson<TranscribeSessionResponse>("transcribe/session", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function confirmDirectFacts(
  caseId: string,
  input: {
    expectedVersion: number;
    kind: "initial" | "reassessment";
    facts: Array<{ path: string; value: string | number | boolean | null | string[]; observedAt?: string; sourceText: string }>;
  },
  signal?: AbortSignal,
) {
  return authorizedJson<{ confirmedState: { version: number }; message: string }>(`cases/${encodeURIComponent(caseId)}/direct-facts`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function createRealtimeSession(caseId: string, signal?: AbortSignal) {
  return authorizedJson<RealtimeSessionResponse>(`cases/${encodeURIComponent(caseId)}/realtime-session`, {
    method: "POST",
    body: JSON.stringify({ caseId }),
    signal,
  });
}

export function createReportDraft(caseId: string, signal?: AbortSignal) {
  return authorizedJson<{ report: unknown }>(`cases/${encodeURIComponent(caseId)}/report/draft`, {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
}

export function reviewReport(caseId: string, reviewedFields: string[], signal?: AbortSignal) {
  return authorizedJson<{ report: unknown }>(`cases/${encodeURIComponent(caseId)}/report/review`, {
    method: "POST",
    body: JSON.stringify({ reviewedFields }),
    signal,
  });
}

export function finalizeReport(caseId: string, signal?: AbortSignal) {
  return authorizedJson<{ report: unknown }>(`cases/${encodeURIComponent(caseId)}/report/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
}

export type RealtimeCallbacks = {
  onMessage(message: CaseRealtimeMessage): void;
  onState(state: "connecting" | "connected" | "reconnecting" | "disconnected"): void;
  onError(error: Error): void;
};

export class CaseRealtimeClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;

  constructor(private readonly caseId: string, private readonly callbacks: RealtimeCallbacks) {}

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "client closed");
    this.socket = null;
    this.callbacks.onState("disconnected");
  }

  private async connect() {
    this.callbacks.onState(this.attempt ? "reconnecting" : "connecting");
    try {
      const session = await createRealtimeSession(this.caseId);
      if (this.stopped) return;
      const socket = new WebSocket(session.websocketUrl);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.attempt = 0;
        this.callbacks.onState("connected");
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as CaseRealtimeMessage;
          this.callbacks.onMessage(message);
        } catch {
          this.callbacks.onError(new Error("실시간 메시지를 확인하지 못했습니다."));
        }
      });
      socket.addEventListener("error", () => this.callbacks.onError(new Error("실시간 연결이 불안정합니다.")));
      socket.addEventListener("close", () => this.scheduleReconnect());
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error("실시간 연결을 시작하지 못했습니다."));
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    this.callbacks.onState("reconnecting");
    const delay = Math.min(30_000, 800 * 2 ** Math.min(this.attempt, 5)) + Math.round(Math.random() * 400);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
