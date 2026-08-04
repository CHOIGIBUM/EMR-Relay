"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventStreamMessages, encodeAudioEvent } from "@/lib/amazonEventStream";
import type { TranscribeSession } from "@/lib/v2/types";

type PttState = "idle" | "starting" | "listening" | "stopping";
type TranscriptPayload = {
  Transcript?: { Results?: Array<{ IsPartial?: boolean; Alternatives?: Array<{ Transcript?: string }> }> };
};

type ActiveAudio = {
  socket: WebSocket;
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  silent: GainNode;
};

async function disposeResources(resources: Partial<ActiveAudio>, closeSocket: boolean) {
  try { resources.worklet?.disconnect(); } catch { /* already disconnected */ }
  try { resources.source?.disconnect(); } catch { /* already disconnected */ }
  try { resources.silent?.disconnect(); } catch { /* already disconnected */ }
  resources.stream?.getTracks().forEach((track) => track.stop());
  if (resources.context && resources.context.state !== "closed") await resources.context.close().catch(() => undefined);
  if (closeSocket && resources.socket && (resources.socket.readyState === WebSocket.OPEN || resources.socket.readyState === WebSocket.CONNECTING)) {
    resources.socket.close(1000, "PTT closed");
  }
}

type SessionCreator = (caseId: string) => Promise<TranscribeSession>;

export function useTranscribePtt(createTranscribeSession: SessionCreator) {
  const activeRef = useRef<ActiveAudio | null>(null);
  const pendingRef = useRef<Partial<ActiveAudio> | null>(null);
  const startIdRef = useRef(0);
  const finalPartsRef = useRef<string[]>([]);
  const partialRef = useRef("");
  const finalWaitersRef = useRef(new Set<() => void>());
  const flushResolverRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<PttState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(async (closeSocket = true) => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active) await disposeResources(active, closeSocket);
  }, []);

  const start = useCallback(async (caseId: string) => {
    if (activeRef.current || pendingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 기기에서는 마이크 입력을 사용할 수 없습니다.");
    const startId = ++startIdRef.current;
    const pending: Partial<ActiveAudio> = {};
    pendingRef.current = pending;
    const assertCurrent = () => {
      if (startId !== startIdRef.current) throw new DOMException("음성 입력이 취소되었습니다.", "AbortError");
    };
    setState("starting");
    setError(null);
    setTranscript("");
    finalPartsRef.current = [];
    partialRef.current = "";

    try {
      pending.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
      assertCurrent();
      pending.context = new AudioContext();
      await pending.context.audioWorklet.addModule("/audio-processor.worklet.js");
      await pending.context.resume();
      assertCurrent();
      const session = await createTranscribeSession(caseId);
      assertCurrent();
      pending.socket = new WebSocket(session.websocketUrl);
      pending.socket.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("음성 연결 시간이 초과되었습니다.")), 10_000);
        pending.socket?.addEventListener("open", () => { window.clearTimeout(timer); resolve(); }, { once: true });
        pending.socket?.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("음성 연결을 시작하지 못했습니다.")); }, { once: true });
      });
      assertCurrent();
      pending.source = pending.context.createMediaStreamSource(pending.stream);
      pending.worklet = new AudioWorkletNode(pending.context, "ems-relay-pcm", { processorOptions: { outputSampleRate: 16000 } });
      pending.silent = pending.context.createGain();
      pending.silent.gain.value = 0;
      const active = pending as ActiveAudio;

      active.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer | { type?: string }>) => {
        if (event.data instanceof ArrayBuffer) {
          if (active.socket.readyState === WebSocket.OPEN) active.socket.send(encodeAudioEvent(event.data));
          return;
        }
        if (event.data?.type === "flushed") {
          flushResolverRef.current?.();
          flushResolverRef.current = null;
        }
      };
      active.socket.addEventListener("message", (event) => {
        void (async () => {
          const raw = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data as ArrayBuffer;
          for (const message of decodeEventStreamMessages(raw)) {
            if (message.headers[":message-type"] === "exception") {
              setError("음성을 인식하지 못했습니다. 다시 말씀해 주세요.");
              continue;
            }
            try {
              const payload = JSON.parse(new TextDecoder().decode(message.payload)) as TranscriptPayload;
              for (const result of payload.Transcript?.Results ?? []) {
                const text = result.Alternatives?.[0]?.Transcript?.trim();
                if (!text) continue;
                if (result.IsPartial) partialRef.current = text;
                else {
                  finalPartsRef.current.push(text);
                  partialRef.current = "";
                  for (const notify of finalWaitersRef.current) notify();
                }
                setTranscript([...finalPartsRef.current, partialRef.current].filter(Boolean).join(" "));
              }
            } catch { /* ignore non-transcript frames */ }
          }
        })();
      });
      active.source.connect(active.worklet);
      active.worklet.connect(active.silent);
      active.silent.connect(active.context.destination);
      pendingRef.current = null;
      activeRef.current = active;
      setState("listening");
    } catch (reason) {
      if (pendingRef.current === pending) pendingRef.current = null;
      await disposeResources(pending, true);
      setState("idle");
      const message = reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "마이크 권한이 필요합니다. 기기 설정에서 권한을 허용해 주세요."
        : reason instanceof DOMException && reason.name === "AbortError"
          ? "음성 입력을 취소했습니다."
          : reason instanceof Error ? reason.message : "음성 입력을 시작하지 못했습니다.";
      setError(message);
      throw new Error(message);
    }
  }, [createTranscribeSession]);

  const flushWorklet = useCallback((worklet: AudioWorkletNode) => new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      flushResolverRef.current = null;
      resolve();
    };
    flushResolverRef.current = finish;
    worklet.port.postMessage({ type: "flush" });
    window.setTimeout(finish, 350);
  }), []);

  const waitForFinalTranscript = useCallback((socket: WebSocket) => new Promise<void>((resolve) => {
    let settled = false;
    let quietTimer: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) window.clearTimeout(quietTimer);
      window.clearTimeout(timeout);
      finalWaitersRef.current.delete(onFinal);
      socket.removeEventListener("close", onClose);
      resolve();
    };
    const onFinal = () => {
      if (quietTimer) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, 180);
    };
    const onClose = () => { quietTimer = window.setTimeout(finish, 80); };
    const timeout = window.setTimeout(finish, 2_500);
    finalWaitersRef.current.add(onFinal);
    socket.addEventListener("close", onClose, { once: true });
  }), []);

  const stop = useCallback(async () => {
    const active = activeRef.current;
    if (!active) { setState("idle"); return finalPartsRef.current.join(" ").trim(); }
    setState("stopping");
    await flushWorklet(active.worklet);
    activeRef.current = null;
    const canFinishStream = active.socket.readyState === WebSocket.OPEN;
    const finalTranscriptReady = canFinishStream ? waitForFinalTranscript(active.socket) : Promise.resolve();
    if (canFinishStream) active.socket.send(encodeAudioEvent(new ArrayBuffer(0)));
    await disposeResources(active, false);
    await finalTranscriptReady;
    if (active.socket.readyState === WebSocket.OPEN || active.socket.readyState === WebSocket.CONNECTING) active.socket.close(1000, "PTT released");
    setState("idle");
    return finalPartsRef.current.join(" ").trim();
  }, [flushWorklet, waitForFinalTranscript]);

  const cancel = useCallback(() => {
    startIdRef.current += 1;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void disposeResources(pending, true);
    void cleanup(true);
    setState("idle");
    setTranscript("");
  }, [cleanup]);

  useEffect(() => () => {
    startIdRef.current += 1;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void disposeResources(pending, true);
    void cleanup(true);
  }, [cleanup]);

  return { state, transcript, error, start, stop, cancel };
}
