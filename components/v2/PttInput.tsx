"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AlertTriangle, CheckCircle2, Mic, WandSparkles } from "lucide-react";
import { useTranscribePtt } from "@/hooks/useTranscribePtt";
import type { VoiceProposal, VoiceProposalChange, VoiceUpdateFocus } from "@/lib/v2/types";
import { displayVoiceValue, VOICE_FIELD_LABELS } from "@/lib/v2/voiceProposal";
import { useV2 } from "./V2Provider";
import styles from "./V2.module.css";

type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => BrowserRecognition;

export default function PttInput({
  caseId,
  value,
  focus = "VITALS",
  onChange,
  onApply,
}: {
  caseId: string;
  value: string;
  focus?: VoiceUpdateFocus;
  onChange(value: string): void;
  onApply(changes: VoiceProposalChange[]): void;
}) {
  const { api } = useV2();
  const createSession = useCallback((id: string) => api.createTranscribeSession(id), [api]);
  const transcribe = useTranscribePtt(createSession);
  const localRecognition = useRef<BrowserRecognition | null>(null);
  const localTranscriptRef = useRef("");
  const valueRef = useRef(value);
  const pressActiveRef = useRef(false);
  const remoteStartRef = useRef<Promise<void> | null>(null);
  const [localListening, setLocalListening] = useState(false);
  const [localTranscript, setLocalTranscript] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [structuredTranscript, setStructuredTranscript] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [structuring, setStructuring] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const remote = process.env.NEXT_PUBLIC_EMS_DATA_MODE === "remote";
  const listening = remote ? transcribe.state === "listening" || transcribe.state === "starting" : localListening;
  const stopping = remote && transcribe.state === "stopping";
  const liveTranscript = remote ? transcribe.transcript : localTranscript;
  const focusLabel = focus === "BASIC" ? "기본 상태" : focus === "CPSS" ? "CPSS" : "활력·시간";

  useEffect(() => () => localRecognition.current?.abort(), []);
  useEffect(() => { valueRef.current = value; }, [value]);

  const structureText = async (text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      setProposalError("먼저 음성을 인식하거나 문장을 입력해 주세요.");
      return;
    }
    setStructuring(true);
    setProposalError(null);
    try {
      const next = await api.structureVoiceUpdate(caseId, normalized, focus);
      setProposal(next);
      setStructuredTranscript(normalized);
      setSelected(new Set(next.changes.filter((change) => change.certainty !== "unknown").map((change) => change.changeId)));
    } catch (reason) {
      setProposalError(reason instanceof Error ? reason.message : "음성 내용을 정리하지 못했습니다.");
    } finally {
      setStructuring(false);
    }
  };

  const startLocal = () => {
    const source = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Recognition = source.SpeechRecognition ?? source.webkitSpeechRecognition;
    if (!Recognition) {
      setLocalError("이 브라우저에서는 음성 인식을 사용할 수 없습니다. 직접 메모를 입력해 주세요.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (text) {
        localTranscriptRef.current = text;
        setLocalTranscript(text);
        onChange(text);
      }
    };
    recognition.onerror = () => {
      setLocalError("음성을 인식하지 못했습니다. 다시 말씀하거나 직접 입력해 주세요.");
      setLocalListening(false);
    };
    recognition.onend = () => setLocalListening(false);
    localRecognition.current = recognition;
    localTranscriptRef.current = "";
    setLocalTranscript("");
    setProposal(null);
    setLocalError(null);
    setLocalListening(true);
    recognition.start();
  };

  const beginPress = async () => {
    if (pressActiveRef.current || structuring || stopping) return;
    pressActiveRef.current = true;
    if (remote) {
      setProposal(null);
      const startPromise = transcribe.start(caseId);
      remoteStartRef.current = startPromise;
      try {
        await startPromise;
      } catch {
        // The hook exposes a user-facing error below.
      } finally {
        if (remoteStartRef.current === startPromise) remoteStartRef.current = null;
      }
      return;
    }
    startLocal();
  };

  const endPress = async () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    if (remote) {
      if (remoteStartRef.current) {
        transcribe.cancel();
        remoteStartRef.current = null;
        return;
      }
      try {
        const transcript = await transcribe.stop();
        if (transcript) {
          onChange(transcript);
          await structureText(transcript);
        }
      } catch {
        // The hook exposes a user-facing error below.
      }
      return;
    }
    const transcript = localTranscriptRef.current.trim() || valueRef.current.trim();
    localRecognition.current?.stop();
    setLocalListening(false);
    if (transcript) await structureText(transcript);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void beginPress();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void endPress();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      void beginPress();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void endPress();
    }
  };

  const structure = async () => {
    await structureText(value);
  };

  const apply = () => {
    if (!proposal || structuredTranscript !== value.trim()) return;
    const reviewed = proposal.changes.filter((change) => selected.has(change.changeId));
    if (!reviewed.length) {
      setProposalError("초안에 반영할 항목을 선택해 주세요.");
      return;
    }
    onApply(reviewed);
    onChange("");
    setProposal(null);
    setStructuredTranscript("");
    setSelected(new Set());
    setProposalError(null);
  };

  return (
    <section className={styles.pttPanel}>
      <div><small>빠른 입력</small><h3>{focusLabel} 음성 입력</h3><p>말을 마치면 항목을 자동으로 정리합니다.</p></div>
      <div className={styles.pttActions}>
        <button
          type="button"
          data-listening={listening}
          disabled={structuring || stopping}
          aria-pressed={listening}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className={styles.recordIcon}><Mic /><i /></span> {stopping ? "인식 마무리 중" : listening ? "손을 떼면 입력 완료" : "길게 눌러 말하기"}
        </button>
      </div>
      <div className={styles.liveTranscript} data-listening={listening} role="status" aria-live="polite">
        <span><i /> {listening ? "실시간 인식" : value.trim() ? "인식 완료" : "음성 대기"}</span>
        <p>{listening ? liveTranscript || "말씀하세요…" : value.trim() || "버튼을 누르고 환자 상태를 말해 주세요."}</p>
      </div>
      <label className={styles.transcriptEditor}><span>인식 문장 확인</span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="인식 문장을 여기서 수정할 수 있습니다." rows={2} /></label>
      {!listening && value.trim() && (!proposal || structuredTranscript !== value.trim()) ? <button type="button" className={styles.restructureVoice} disabled={structuring} onClick={() => void structure()}>
        <WandSparkles /> {structuring ? "정리 중" : "수정 문장 다시 정리"}
      </button> : null}
      {(remote ? transcribe.error : localError) ? <span role="alert">{remote ? transcribe.error : localError}</span> : null}
      {proposal ? <div className={styles.voiceReview}>
        <header><div><small>AI 정리 초안</small><strong>{proposal.summary}</strong></div><b><AlertTriangle /> 검토 후 반영</b></header>
        {proposal.changes.length ? <div className={styles.voiceProposalList}>{proposal.changes.map((change) => <label key={change.changeId}>
          <input
            type="checkbox"
            checked={selected.has(change.changeId)}
            onChange={(event) => setSelected((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(change.changeId); else next.delete(change.changeId);
              return next;
            })}
          />
          <span><small>{VOICE_FIELD_LABELS[change.path] ?? change.path}</small><strong>{displayVoiceValue(change)}</strong><em>“{change.sourceText}”</em></span>
        </label>)}</div> : <p>명확하게 추출된 항목이 없습니다. 문장을 직접 확인해 주세요.</p>}
        {structuredTranscript !== value.trim() ? <span role="alert">인식 문장이 바뀌었습니다. 항목을 다시 정리해 주세요.</span> : null}
        <button type="button" disabled={!proposal.changes.length || structuredTranscript !== value.trim()} onClick={apply}><CheckCircle2 /> 선택값 적용</button>
      </div> : null}
      {proposalError ? <span role="alert">{proposalError}</span> : null}
    </section>
  );
}
