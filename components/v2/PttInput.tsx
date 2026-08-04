"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Mic, Square, WandSparkles } from "lucide-react";
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
  const [localListening, setLocalListening] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [structuredTranscript, setStructuredTranscript] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [structuring, setStructuring] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const remote = process.env.NEXT_PUBLIC_EMS_DATA_MODE === "remote";
  const listening = remote ? transcribe.state === "listening" || transcribe.state === "starting" : localListening;

  useEffect(() => () => localRecognition.current?.abort(), []);

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
      if (text) onChange(text);
    };
    recognition.onerror = () => {
      setLocalError("음성을 인식하지 못했습니다. 다시 말씀하거나 직접 입력해 주세요.");
      setLocalListening(false);
    };
    recognition.onend = () => setLocalListening(false);
    localRecognition.current = recognition;
    setLocalError(null);
    setLocalListening(true);
    recognition.start();
  };

  const toggle = async () => {
    if (remote) {
      try {
        if (listening) {
          const transcript = await transcribe.stop();
          if (transcript) onChange(transcript);
        } else {
          await transcribe.start(caseId);
        }
      } catch {
        // The hook exposes a user-facing error below.
      }
      return;
    }
    if (localListening) {
      localRecognition.current?.stop();
      setLocalListening(false);
    } else startLocal();
  };

  const structure = async () => {
    if (!value.trim()) {
      setProposalError("먼저 음성을 인식하거나 문장을 입력해 주세요.");
      return;
    }
    setStructuring(true);
    setProposalError(null);
    try {
      const next = await api.structureVoiceUpdate(caseId, value.trim(), focus);
      setProposal(next);
      setStructuredTranscript(value.trim());
      setSelected(new Set(next.changes.filter((change) => change.certainty !== "unknown").map((change) => change.changeId)));
    } catch (reason) {
      setProposalError(reason instanceof Error ? reason.message : "음성 내용을 정리하지 못했습니다.");
    } finally {
      setStructuring(false);
    }
  };

  const apply = () => {
    if (!proposal || structuredTranscript !== value.trim()) return;
    const reviewed = proposal.changes.filter((change) => selected.has(change.changeId));
    if (!reviewed.length) {
      setProposalError("초안에 반영할 항목을 선택해 주세요.");
      return;
    }
    onApply(reviewed);
    setProposalError(null);
  };

  return (
    <section className={styles.pttPanel}>
      <div><small>선택 입력</small><h3>음성 메모</h3><p>인식 문장은 확정값이 아닙니다. 아래 내용을 확인한 뒤 카드에 저장하세요.</p></div>
      <div className={styles.pttActions}>
        <button type="button" data-listening={listening} onClick={() => void toggle()}>
          {listening ? <Square /> : <Mic />} {listening ? "입력 마침" : "음성 입력"}
        </button>
        <button type="button" disabled={listening || structuring || !value.trim()} onClick={() => void structure()}>
          <WandSparkles /> {structuring ? "정리 중" : "항목 정리"}
        </button>
      </div>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="음성 인식 결과 또는 현장 메모" rows={3} />
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
        <button type="button" disabled={!proposal.changes.length || structuredTranscript !== value.trim()} onClick={apply}><CheckCircle2 /> 선택 항목을 입력 초안에 반영</button>
      </div> : null}
      {proposalError ? <span role="alert">{proposalError}</span> : null}
    </section>
  );
}
