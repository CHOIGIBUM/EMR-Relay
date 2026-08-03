"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartPulse,
  Hospital,
  Info,
  MapPin,
  Mic,
  Navigation,
  Phone,
  RadioTower,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import {
  CARDIO_DEMO_HANDOFF,
  CARDIO_DEMO_PTT_UPDATES,
  CARDIO_DEMO_VITALS,
  HOSPITALS,
  SCENARIO,
  STAGE_LABEL,
  stageAtLeast,
  useDemo,
  type HospitalOption,
  type VitalValues,
} from "./DemoContext";
import type { CardioPttProposal, CardioPttUpdate } from "@/lib/cardioDemoData";
import styles from "./MobileApp.module.css";

type Tab = "field" | "patient" | "hospital" | "handoff";
type VoiceMode = "listening" | "processing" | "review" | null;
type HospitalCandidateStatus = "available" | "locked" | "pending" | "info" | "accepted" | "declined" | "confirmed";

type VoiceResult = {
  update: CardioPttUpdate;
  source: "local-agent";
};

const API_BASE = (process.env.NEXT_PUBLIC_EMS_API_BASE ?? "/api/local").replace(/\/$/, "");

function defaultTab(stage: ReturnType<typeof useDemo>["state"]["stage"]): Tab {
  if (["coordination-requested", "hospital-requested", "info-requested", "info-sent", "declined", "accepted", "destination-confirmed"].includes(stage)) return "hospital";
  if (["hospital-arrived", "handoff-sent", "complete"].includes(stage)) return "handoff";
  if (stage === "summary-ready") return "patient";
  return "field";
}

const vitalFields: Array<{ key: keyof VitalValues; label: string; unit: string; placeholder: string }> = [
  { key: "bp", label: "혈압 BP", unit: "mmHg", placeholder: "예: 163/90" },
  { key: "pr", label: "맥박 PR", unit: "회/분", placeholder: "예: 91" },
  { key: "rr", label: "호흡수 RR", unit: "회/분", placeholder: "예: 23" },
  { key: "spo2", label: "SpO₂", unit: "%", placeholder: "예: 96" },
  { key: "temp", label: "체온", unit: "℃", placeholder: "예: 37.4" },
  { key: "glucose", label: "혈당", unit: "mg/dL", placeholder: "예: 116" },
];

const reassessmentFixture = CARDIO_DEMO_VITALS[1];
const reassessmentDefaults: VitalValues = {
  bp: `${reassessmentFixture.bloodPressure.systolic}/${reassessmentFixture.bloodPressure.diastolic}`,
  pr: String(reassessmentFixture.heartRate.value),
  rr: String(reassessmentFixture.respiratoryRate.value),
  spo2: String(reassessmentFixture.spo2.value),
  temp: String(reassessmentFixture.temperature.value),
  glucose: String(reassessmentFixture.bloodGlucose.value),
};

const HOSPITAL_CONTEXT: Record<string, string> = {
  "H-GW-EMG-020": "정적 기관정보 · 실제 수용 여부는 회신으로만 확인",
  "H-GW-EMG-016": "심장내과 등록정보 · 현재 대응 여력은 별도 확인",
  "H-GW-EMG-012": "응급실 등록정보 · 현재 진료 가능 여부 확인 필요",
};

function reviewTone(status: CardioPttProposal["status"]): "confirmed" | "unknown" | "neutral" {
  if (status === "confirmed") return "confirmed";
  if (status === "unknown") return "unknown";
  return "neutral";
}

function StatusBadge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.statusBadge} data-tone={tone}>{children}</span>;
}

function SourceTag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "confirmed" | "unknown" }) {
  return <span className={styles.sourceTag} data-tone={tone}>{children}</span>;
}

export default function MobileApp() {
  const { state, dispatch, selectedHospital, transition } = useDemo();
  const [caseOpen, setCaseOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(() => defaultTab(state.stage));
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(null);
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<string[]>([]);
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [callingHospitalId, setCallingHospitalId] = useState<string | null>(null);
  const [showReassessmentForm, setShowReassessmentForm] = useState(false);
  const [reassessmentDraft, setReassessmentDraft] = useState<VitalValues>(reassessmentDefaults);
  const [reassessmentTrend, setReassessmentTrend] = useState("흉통 및 식은땀 일부 호전");
  const toastRef = useRef<number | null>(null);
  const timeFor = (...titles: string[]) =>
    [...state.events].reverse().find((event) => titles.includes(event.title))?.time ?? "—";
  const latestEventTime = state.events.at(-1)?.time ?? "—";
  const voiceModeRef = useRef<VoiceMode>(null);
  const voiceRequestRef = useRef<AbortController | null>(null);
  const voiceRequestIdRef = useRef(0);
  const callingHospital = HOSPITALS.find((hospital) => hospital.id === callingHospitalId) ?? null;
  const nextPttUpdate = useMemo(() => {
    const pending = CARDIO_DEMO_PTT_UPDATES.filter((update) => !state.confirmedPttIds.includes(update.id));
    if (state.stage === "transporting") return pending.find((update) => update.sequence === 4) ?? null;
    return pending.find((update) => update.sequence <= 3) ?? null;
  }, [state.confirmedPttIds, state.stage]);
  const transcriptSteps = useMemo(() => {
    const transcript = nextPttUpdate?.transcript ?? "확인할 다음 음성 입력이 없습니다.";
    const parts = transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.length ? parts.map((_, index) => parts.slice(0, index + 1).join(" ")) : [transcript];
  }, [nextPttUpdate]);

  const notify = (message: string) => {
    setToast(message);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => () => {
    if (toastRef.current) window.clearTimeout(toastRef.current);
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
  }, []);

  useEffect(() => {
    if (voiceMode !== "listening") return;
    const timer = window.setInterval(() => {
      setTranscriptIndex((current) => Math.min(current + 1, transcriptSteps.length - 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [voiceMode, transcriptSteps.length]);

  const assessmentReady = useMemo(
    () => state.vitalsConfirmed && state.avpu !== "미확인" && CARDIO_DEMO_PTT_UPDATES.slice(0, 3).every((update) => state.confirmedPttIds.includes(update.id)),
    [state.vitalsConfirmed, state.avpu, state.confirmedPttIds],
  );

  const setVoicePhase = (next: VoiceMode) => {
    voiceModeRef.current = next;
    setVoiceMode(next);
  };

  const cancelVoice = () => {
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
    setVoicePhase(null);
  };

  const beginVoice = () => {
    if (voiceModeRef.current !== null || !nextPttUpdate) return;
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
    setTranscriptIndex(0);
    setVoicePhase("listening");
  };

  const finishVoice = () => {
    const pendingUpdate = nextPttUpdate;
    if (voiceModeRef.current !== "listening" || !pendingUpdate) return;

    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;
    const controller = new AbortController();
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = controller;
    setVoicePhase("processing");

    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "STRUCTURE_VOICE_UPDATE",
            incidentId: SCENARIO.id,
            locale: "ko-KR",
            updateId: pendingUpdate.id,
            transcript: pendingUpdate.transcript,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Voice agent request failed: ${response.status}`);
        const payload = await response.json() as { update?: CardioPttUpdate };
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        if (!payload.update || payload.update.id !== pendingUpdate.id) throw new Error("Voice update contract mismatch");
        const update = payload.update;
        setVoiceResult({ update, source: "local-agent" });
        setAcceptedProposalIds(update.proposals.map((proposal) => proposal.id));
        setVoicePhase("review");
      } catch {
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        setVoiceResult(null);
        setAcceptedProposalIds([]);
        setVoicePhase("review");
      } finally {
        if (voiceRequestIdRef.current === requestId) voiceRequestRef.current = null;
      }
    })();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    beginVoice();
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishVoice();
  };

  const handleVoiceKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && voiceModeRef.current === null) {
      event.preventDefault();
      beginVoice();
    }
  };

  const handleVoiceKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      finishVoice();
    }
  };

  const phoneHeader = (
    <>
      <div className={styles.deviceBar}>
        <strong>{latestEventTime}</strong>
        <span>●●●　Wi-Fi　▰</span>
      </div>
      <header className={styles.appHeader}>
        <div className={styles.brandMark}><Activity size={21} strokeWidth={2.8} /></div>
        <div className={styles.brandText}><strong>EMS Relay</strong><span>구급대 현장 기록</span></div>
        <div className={styles.connection}><Wifi size={13} /><i /> 연결됨</div>
      </header>
    </>
  );

  const contextHeader = (title: string, back?: () => void) => (
    <div className={styles.contextHeader}>
      {back && <button onClick={back} aria-label="이전 화면"><ArrowLeft size={19} /></button>}
      <div><strong>{title}</strong><span>{SCENARIO.id}</span></div>
      <StatusBadge tone={state.stage === "complete" ? "green" : "teal"}>{STAGE_LABEL[state.stage]}</StatusBadge>
    </div>
  );

  const renderCaseList = () => (
    <>
      {contextHeader("출동 목록")}
      <main className={styles.phoneScroll}>
        <div className={styles.listLead}>
          <div><span>현재 배정</span><h1>출동 사건 1건</h1><p>사건을 선택해 신고 내용을 확인하세요.</p></div>
          <button aria-label="출동 목록 새로고침" onClick={() => notify("최신 배정 상태입니다.")}><RefreshCw size={18} /></button>
        </div>
        <button className={styles.caseCard} onClick={() => setCaseOpen(true)}>
          <div className={styles.caseTop}>
            <span>{SCENARIO.id}</span>
            <time><Clock3 size={14} /> 지령 {timeFor("구급대 출동 지령")}</time>
          </div>
          <strong>흉통·식은땀</strong>
          <p>{SCENARIO.reportedPatient} · {SCENARIO.reportedComplaint}</p>
          <div className={styles.caseLocation}><MapPin size={15} /> {SCENARIO.locationShort}</div>
          <div className={styles.caseFooter}><StatusBadge tone="amber">출동 배정</StatusBadge><span>{SCENARIO.unit}</span><ChevronRight size={19} /></div>
        </button>
        <div className={styles.emptyList}><ClipboardCheck size={21} /><span>다른 배정 사건이 없습니다.</span></div>
      </main>
    </>
  );

  const renderDispatch = () => {
    const enroute = state.stage === "enroute";
    return (
      <>
        {contextHeader(enroute ? "현장 이동" : "신고 내용", state.stage === "assigned" ? () => setCaseOpen(false) : undefined)}
        <main className={styles.phoneScroll}>
          <section className={styles.reportCard}>
            <div className={styles.cardEyebrow}><Phone size={15} /> 신고로 파악된 내용 <SourceTag>현장 미확인</SourceTag></div>
            <h1>{SCENARIO.reportedPatient}</h1>
            <p>{SCENARIO.reportedComplaint}</p>
            <dl>
              <div><dt>신고자</dt><dd>{SCENARIO.caller}</dd></div>
              <div><dt>신고시각</dt><dd>{timeFor("119 신고 접수")}</dd></div>
              <div><dt>신고 당시</dt><dd>의식 있음 · 자발호흡</dd></div>
              <div><dt>증상 시작</dt><dd>정확한 시각 현장 확인 필요</dd></div>
            </dl>
          </section>

          <section className={styles.routeCard}>
            <div className={styles.mapMini}>
              <span className={styles.mapOrigin}><Ambulance size={16} /></span>
              <i />
              <span className={styles.mapDestination}><MapPin size={16} /></span>
            </div>
            <div><span>현장까지</span><strong>{enroute ? "31분" : "34분"}</strong><small>27.4 km · 속초권 도로 기준</small></div>
            <Navigation size={20} />
          </section>

          <section className={styles.locationCard}>
            <div><MapPin size={18} /><strong>{SCENARIO.location}</strong></div>
            <p>{SCENARIO.access}</p>
            <button onClick={() => notify("신고자에게 전화를 연결합니다.")}><Phone size={16} /> 신고자 전화</button>
          </section>

          <div className={styles.timeStrip}>
            <div data-state="done"><span><Check size={13} /></span><strong>신고 접수</strong><time>{timeFor("119 신고 접수")}</time></div>
            <i />
            <div data-state={enroute ? "done" : "current"}><span>{enroute ? <Check size={13} /> : "2"}</span><strong>출동 시작</strong><time>{enroute ? timeFor("출동 시작") : "확인 전"}</time></div>
            <i />
            <div data-state={enroute ? "current" : "waiting"}><span>3</span><strong>현장 도착</strong><time>도착 후 확인</time></div>
          </div>
        </main>
        <div className={styles.stickyAction}>
          {!enroute ? (
            <button className={styles.primaryAction} onClick={() => transition("enroute", "구급대원", "출동 시작", `${SCENARIO.unit} · 사용자 확인 시각 기록`, "teal")}>
              <Ambulance size={21} /> 출동 시작
            </button>
          ) : (
            <button className={styles.primaryAction} onClick={() => transition("scene-arrived", "구급대원", "현장 도착", `${SCENARIO.location} · GPS 확인`, "teal")}>
              <MapPin size={21} /> 현장 도착
            </button>
          )}
          <span>버튼을 누른 시각과 위치가 자동 기록됩니다.</span>
        </div>
      </>
    );
  };

  const renderArrival = () => (
    <>
      {contextHeader("현장 도착")}
      <main className={styles.phoneScroll}>
        <section className={styles.arrivalHero}>
          <span><CheckCircle2 size={28} /></span>
          <h1>현장 도착을 기록했습니다</h1>
          <p>{timeFor("현장 도착")} · {SCENARIO.location}</p>
        </section>
        <section className={styles.arrivalChecklist}>
          <div><ShieldCheck size={18} /><span><strong>현장 안전 확인</strong><small>특이 위험요소 신고 없음</small></span><StatusBadge tone="teal">확인</StatusBadge></div>
          <div><MapPin size={18} /><span><strong>환자 위치</strong><small>{SCENARIO.access}</small></span></div>
          <div><UserRound size={18} /><span><strong>정보 제공자</strong><small>{SCENARIO.caller} 진술 확인</small></span></div>
        </section>
        <div className={styles.noticeBox}><Info size={18} /><span><strong>현장 도착과 환자 접촉은 다릅니다.</strong><small>환자를 실제로 확인한 뒤 접촉 버튼을 눌러주세요.</small></span></div>
      </main>
      <div className={styles.stickyAction}>
        <button className={styles.primaryAction} onClick={() => transition("patient-contact", "구급대원", "환자 접촉", `${SCENARIO.patient} · 현장 직접 확인`, "teal")}>
          <UserRound size={21} /> 환자 접촉
        </button>
        <span>환자를 실제로 확인한 시각이 기록됩니다.</span>
      </div>
    </>
  );

  const renderFieldAssessment = () => (
    <>
      <section className={styles.patientIdentity}>
        <div><span>현장에서 확인한 환자</span><h1>{SCENARIO.patient}</h1><p>{SCENARIO.living}</p></div>
        <SourceTag tone="confirmed">구급대 확인</SourceTag>
      </section>

      <div className={styles.warningBox}><AlertTriangle size={18} /><span><strong>신고 내용은 진단 결과가 아닙니다.</strong><small>환자 상태를 직접 평가하고 확인한 값만 공유합니다.</small></span></div>

      <section className={styles.formSection}>
        <div className={styles.sectionTitle}><div><HeartPulse size={18} /><strong>최초 활력징후</strong></div><span>측정시각 {state.vitalsConfirmed ? timeFor("최초 활력징후 확인") : "미기록"}</span></div>
        {!state.vitalsConfirmed && (
          <button className={styles.measureButton} onClick={() => dispatch({ type: "LOAD_VITALS" })}>
            <Activity size={18} /><span><strong>활력징후 입력 시작</strong><small>측정값을 확인하고 필요하면 수정하세요.</small></span><ArrowRight size={17} />
          </button>
        )}
        <div className={styles.vitalGrid}>
          {vitalFields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <div><input value={state.vitals[field.key]} placeholder={field.placeholder} onChange={(event) => dispatch({ type: "SET_VITAL", key: field.key, value: event.target.value })} /><small>{field.unit}</small></div>
            </label>
          ))}
        </div>
        <div className={styles.choiceRow}>
          <span><strong>의식수준 AVPU</strong><small>환자 반응을 직접 확인</small></span>
          <div>{(["A", "V", "P", "U"] as const).map((value) => <button className={state.avpu === value ? styles.choiceActive : ""} onClick={() => dispatch({ type: "SET_AVPU", value })} key={value}>{value}</button>)}</div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.sectionTitle}><div><Activity size={18} /><strong>심혈관계 집중평가</strong></div><SourceTag tone={state.cardioConfirmed ? "confirmed" : "neutral"}>{state.cardioConfirmed ? "확인됨" : "확인 중"}</SourceTag></div>
        <div className={styles.cardioAssessmentRow}>
          <div><strong>주호소·동반증상</strong><small>환자 진술과 현장 관찰을 구분</small></div>
          <div>{["흉통", "식은땀", "오심"].map((value) => <button className={styles.choiceActive} key={value}>{value}</button>)}</div>
        </div>
        <div className={styles.cardioAssessmentRow}>
          <div><strong>흉통 양상</strong><small>통증 NRS와 부위·방사통 확인</small></div>
          <div><button className={styles.choiceActive}>NRS {SCENARIO.pain.severityNrs}</button><button className={styles.choiceActive}>{SCENARIO.pain.quality}</button></div>
        </div>
        <div className={styles.cardioAssessmentRow}>
          <div><strong>초기 ABC</strong><small>구급대원이 직접 확인</small></div>
          <div><button className={styles.choiceActive}>기도 개방</button><button className={styles.choiceActive}>자발호흡</button></div>
        </div>
      </section>

      <section className={styles.timeSection}>
        <div><span><Clock3 size={17} /> 증상 발생시각</span><strong>{state.confirmedPttIds.includes("GW-CARDIO-050-U02") ? SCENARIO.onset : "확인 필요"}</strong><small>{state.confirmedPttIds.includes("GW-CARDIO-050-U02") ? SCENARIO.onsetSource : "환자·목격자에게 시각을 확인하세요"}</small></div>
        <div><span><FileText size={17} /> PTT 확인 진행</span><strong>{Math.min(state.confirmedPttIds.length, 3)} / 3</strong><small>{nextPttUpdate?.title ?? "현장 입력 확인 완료"}</small></div>
      </section>

      <button
        className={styles.pttButton}
        disabled={!nextPttUpdate}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={finishVoice}
        onKeyDown={handleVoiceKeyDown}
        onKeyUp={handleVoiceKeyUp}
      >
        <span><Mic size={24} /></span>
        <div><strong>{nextPttUpdate ? "누르고 말하기" : "현장 음성 확인 완료"}</strong><small>{nextPttUpdate ? `${nextPttUpdate.sequence}. ${nextPttUpdate.title}` : "이송 중 재평가에서 다시 사용할 수 있습니다"}</small></div>
      </button>

      <button
        className={styles.fullAction}
        disabled={!assessmentReady}
        onClick={() => { dispatch({ type: "CONFIRM_ASSESSMENT" }); setTab("patient"); }}
      >
        <ClipboardCheck size={19} /> 환자 확인본 만들기
      </button>
      {!assessmentReady && <p className={styles.requirement}>최초 활력징후·AVPU와 현장 PTT 3단계를 확인하면 다음 단계로 진행할 수 있습니다.</p>}
    </>
  );

  const renderPatientSummary = () => (
    <>
      <section className={styles.summaryHero}>
        <div className={styles.cardEyebrow}><UserRound size={15} /> 현재 환자 상태 <SourceTag tone={stageAtLeast(state.stage, "summary-ready") ? "confirmed" : "neutral"}>{stageAtLeast(state.stage, "summary-ready") ? "구급대원 확인본" : "작성 중"}</SourceTag></div>
        <h1>{SCENARIO.patient}</h1>
        <p>{SCENARIO.chiefComplaint}</p>
        <div className={styles.summaryFlags}><span>{SCENARIO.impression}</span><span>확정 진단 아님</span><span>AVPU {state.avpu}</span></div>
      </section>

      <section className={styles.compactVitals}>
        <div><span>BP</span><strong>{state.vitals.bp || "—"}</strong><small>mmHg</small></div>
        <div><span>PR</span><strong>{state.vitals.pr || "—"}</strong><small>회/분</small></div>
        <div><span>RR</span><strong>{state.vitals.rr || "—"}</strong><small>회/분</small></div>
        <div><span>SpO₂</span><strong>{state.vitals.spo2 || "—"}</strong><small>%</small></div>
        <div><span>혈당</span><strong>{state.vitals.glucose || "—"}</strong><small>mg/dL</small></div>
        <div><span>AVPU</span><strong>{state.avpu}</strong><small>{timeFor("최초 활력징후 확인", "심혈관 중점평가 확인")}</small></div>
      </section>

      <section className={styles.detailList}>
        <div><span>발생시각</span><strong>{SCENARIO.onset}</strong><small>{SCENARIO.onsetSource}</small></div>
        <div><span>증상</span><strong>{SCENARIO.symptoms.join(" · ")}</strong><small>환자 진술·현장 관찰</small></div>
        <div><span>흉통</span><strong>NRS {SCENARIO.pain.severityNrs} · {SCENARIO.pain.region} · {SCENARIO.pain.radiation} 방사</strong><small>구급대원 확인</small></div>
        <div><span>병력</span><strong>{SCENARIO.history.join(" · ")}</strong><small>환자 진술 · 추가 확인 필요</small></div>
        <div data-tone="unknown"><span>복용약</span><strong>{SCENARIO.medication}</strong><small>진술 기반 · 약제 확인 필요</small></div>
        <div data-tone="unknown"><span>미상 항목</span><strong>{SCENARIO.unresolvedItems.join(" · ")}</strong><small>임의로 채우지 않고 그대로 전달</small></div>
      </section>

      {state.stage === "summary-ready" && (
        <button className={styles.fullAction} onClick={() => setTab("hospital")}>
          <Hospital size={19} /> 병원 후보 확인
        </button>
      )}
    </>
  );

  const renderHospitalStatus = () => {
    const activeRequest = ["hospital-requested", "info-requested", "info-sent"].includes(state.stage);
    const canStartRequest = ["summary-ready", "coordination-requested", "declined"].includes(state.stage);

    const requestEventFor = (hospital: HospitalOption) => [...state.events]
      .reverse()
      .find((event) => event.title === "병원 수용 문의" && event.detail.includes(hospital.name));

    const declineReasonFor = (hospital: HospitalOption) => {
      const event = [...state.events]
        .reverse()
        .find((item) => item.title === "수용 곤란 회신" && item.detail.includes(hospital.name));
      if (!event) return "병원 회신 사유를 확인해 주세요.";
      return event.detail.split("·").slice(1).join("·").trim() || "병원 회신 사유를 확인해 주세요.";
    };

    const candidateStatus = (hospital: HospitalOption): HospitalCandidateStatus => {
      const isSelected = state.selectedHospitalId === hospital.id;
      if (isSelected && state.destinationConfirmed) return "confirmed";
      if (state.declinedHospitalIds.includes(hospital.id)) return "declined";
      if (isSelected && state.stage === "accepted") return "accepted";
      if (isSelected && state.stage === "info-requested") return "info";
      if (isSelected && ["hospital-requested", "info-sent"].includes(state.stage)) return "pending";
      if (activeRequest || state.stage === "accepted" || state.destinationConfirmed) return "locked";
      return "available";
    };

    const status = (() => {
      if (state.stage === "summary-ready") return { icon: Hospital, title: "문의할 병원 한 곳을 선택하세요", detail: "기관정보와 예상 이동시간을 참고해 구급대원이 직접 문의합니다.", tone: "teal" as const };
      if (state.stage === "coordination-requested") return { icon: RadioTower, title: "상황실과 지원 요청을 공유했습니다", detail: "병원 선택과 문의는 현장 구급대원이 계속 진행합니다.", tone: "amber" as const };
      if (state.stage === "hospital-requested") return { icon: Hospital, title: `${selectedHospital?.name ?? "병원"} 회신 대기`, detail: "현재 문의가 끝난 뒤에만 다음 병원에 문의할 수 있습니다.", tone: "amber" as const };
      if (state.stage === "info-requested") return { icon: FileText, title: "병원이 추가정보를 요청했습니다", detail: state.requestedInfo.join(" · "), tone: "amber" as const };
      if (state.stage === "info-sent") return { icon: Send, title: "추가정보를 전달했습니다", detail: "병원 회신을 기다리는 동안 전화로 확인할 수 있습니다.", tone: "teal" as const };
      if (state.stage === "declined") return { icon: RefreshCw, title: "수용 곤란 회신을 확인했습니다", detail: "사유는 기록에 남았습니다. 다음 후보 한 곳을 선택하세요.", tone: "red" as const };
      if (state.stage === "accepted") return { icon: CheckCircle2, title: "수용 가능 회신이 도착했습니다", detail: "환자 상태와 이동 여건을 다시 확인한 뒤 이송지를 확정하세요.", tone: "green" as const };
      if (state.stage === "destination-confirmed") return { icon: Route, title: "이송지를 확인했습니다", detail: "현장 출발 버튼을 누르면 출발시각이 기록됩니다.", tone: "teal" as const };
      return { icon: Hospital, title: "병원 진행을 확인하세요", detail: "문의·회신·이송지 확정 기록을 한곳에서 확인합니다.", tone: "slate" as const };
    })();
    const Icon = status.icon;

    return (
      <>
        <section className={styles.statusHero} data-tone={status.tone}>
          <span><Icon size={26} /></span><div><small>현재 진행</small><h1>{status.title}</h1><p>{status.detail}</p></div>
        </section>

        <section className={styles.coordinationSteps} aria-label="병원 문의 순서">
          <div data-active={canStartRequest}><span>1</span><small>한 곳 문의</small></div>
          <i />
          <div data-active={activeRequest || state.stage === "accepted"}><span>2</span><small>회신 확인</small></div>
          <i />
          <div data-active={state.destinationConfirmed}><span>3</span><small>이송지 확정</small></div>
        </section>

        <section className={styles.candidateSection}>
          <div className={styles.candidateHeading}>
            <div><span>현 위치 기준</span><h2>병원 후보 {HOSPITALS.length}곳</h2></div>
            <StatusBadge tone={activeRequest ? "amber" : "teal"}>{activeRequest ? "1곳 문의 중" : "순차 문의"}</StatusBadge>
          </div>
          <p className={styles.candidateRule}><Info size={14} /> 거리·예상 이동시간·기관정보는 참고이며 수용 가능을 뜻하지 않습니다. 한 번에 한 병원씩 문의합니다.</p>

          <div className={styles.candidateList}>
            {HOSPITALS.map((hospital) => {
              const candidateState = candidateStatus(hospital);
              const requestEvent = requestEventFor(hospital);
              const statusLabel: Record<HospitalCandidateStatus, string> = {
                available: "문의 가능",
                locked: "현재 문의 후",
                pending: "회신 대기",
                info: "추가 확인",
                accepted: "수용 가능",
                declined: "수용 곤란",
                confirmed: "이송지 확정",
              };

              return (
                <article className={styles.hospitalCandidate} data-status={candidateState} key={hospital.id}>
                  <div className={styles.candidateTop}>
                    <span className={styles.candidateOrder}><Hospital size={14} /></span>
                    <div className={styles.candidateName}>
                      <h3>{hospital.name}</h3>
                      <p><MapPin size={12} /> {hospital.location}</p>
                    </div>
                    <span className={styles.candidateStatus} data-status={candidateState}>{statusLabel[candidateState]}</span>
                  </div>

                  <div className={styles.candidateTravel}>
                    <span><Route size={15} /><small>거리</small><strong>{hospital.distance}</strong></span>
                    <span><Clock3 size={15} /><small>예상 이동</small><strong>{hospital.eta}</strong></span>
                  </div>

                  <div className={styles.candidateReferences}>
                    {hospital.reference.map((item) => <span key={item}>{item}</span>)}
                    <small>{HOSPITAL_CONTEXT[hospital.id]}</small>
                  </div>

                  {candidateState === "pending" && (
                    <div className={styles.responseStrip} data-tone="amber"><Clock3 size={16} /><span><strong>병원 회신 대기</strong><small>{requestEvent?.time ?? "방금"} 문의 · 열람 여부와 회신을 확인합니다.</small></span></div>
                  )}
                  {candidateState === "info" && (
                    <div className={styles.responseStrip} data-tone="amber"><FileText size={16} /><span><strong>{state.requestedInfo.join(" · ") || "추가정보"} 요청</strong><small>확인할 수 없으면 빈칸 대신 ‘미상’으로 회신합니다.</small></span></div>
                  )}
                  {candidateState === "declined" && (
                    <div className={styles.responseStrip} data-tone="red"><AlertTriangle size={16} /><span><strong>수용 곤란 사유</strong><small>{declineReasonFor(hospital)}</small></span></div>
                  )}
                  {candidateState === "accepted" && (
                    <div className={styles.responseStrip} data-tone="green"><CheckCircle2 size={16} /><span><strong>수용 가능 회신</strong><small>이송 출발 전 구급대원이 최종 확정합니다.</small></span></div>
                  )}
                  {candidateState === "confirmed" && (
                    <div className={styles.responseStrip} data-tone="green"><Navigation size={16} /><span><strong>최종 이송병원</strong><small>이송 시작 전 환자 상태와 경로를 다시 확인하세요.</small></span></div>
                  )}

                  <div className={styles.candidateActions}>
                    {candidateState === "available" && canStartRequest && (
                      <button aria-label={`${hospital.name}에 수용 문의`} className={styles.candidatePrimary} onClick={() => { dispatch({ type: "REQUEST_HOSPITAL", hospitalId: hospital.id }); notify(`${hospital.name}에 수용 문의를 보냈습니다.`); }}>
                        <Send size={16} /> 이 병원에 수용 문의
                      </button>
                    )}
                    {["pending", "info", "accepted", "declined", "confirmed"].includes(candidateState) && (
                      <button className={styles.candidateSecondary} onClick={() => setCallingHospitalId(hospital.id)}>
                        <Phone size={16} /> 수용 문의 전화
                      </button>
                    )}
                    {candidateState === "info" && (
                      <button className={styles.candidatePrimary} data-tone="amber" onClick={() => dispatch({ type: "ANSWER_INFO" })}>
                        <Send size={16} /> 확인값·미상 구분해 회신
                      </button>
                    )}
                    {candidateState === "accepted" && (
                      <button className={styles.candidatePrimary} data-tone="green" onClick={() => dispatch({ type: "CONFIRM_DESTINATION" })}>
                        <CheckCircle2 size={16} /> 이송병원으로 확정
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {(state.stage === "summary-ready" || state.stage === "declined") && (
            <button className={styles.supportAction} onClick={() => dispatch({ type: "REQUEST_COORDINATION" })}>
              <RadioTower size={16} /> 상황실 연락 지원 요청
            </button>
          )}
        </section>

        {state.destinationConfirmed && selectedHospital && (
          <section className={styles.confirmedDestination}>
            <span><Navigation size={20} /></span>
            <div><small>최종 이송병원</small><strong>{selectedHospital.name}</strong><p>예상 {selectedHospital.eta} · {selectedHospital.distance}</p></div>
          </section>
        )}

        {state.stage === "destination-confirmed" && (
          <button className={styles.fullAction} onClick={() => { transition("transporting", "구급대원", "이송 시작", `${selectedHospital?.name} · ETA ${selectedHospital?.eta}`, "teal"); setTab("field"); }}>
            <Ambulance size={19} /> 이송 시작
          </button>
        )}

        <section className={styles.mobileTimeline}>
          <div className={styles.sectionTitle}><div><Clock3 size={18} /><strong>요청 진행 기록</strong></div></div>
          {[...state.events].reverse().filter((event) => ["병원", "이송조정 상황실", "구급대원"].includes(event.actor)).slice(0, 5).map((event) => (
            <div className={styles.timelineEvent} key={event.id}><time>{event.time}</time><i data-tone={event.tone ?? "neutral"} /><span><strong>{event.title}</strong><small>{event.detail}</small></span></div>
          ))}
        </section>
      </>
    );
  };

  const renderTransport = () => (
    <>
      <section className={styles.transportMap}>
        <div className={styles.mapGrid}>
          <span className={styles.vehicleMarker}><Ambulance size={18} /></span>
          <i className={styles.routeLine} />
          <span className={styles.hospitalMarker}><Hospital size={18} /></span>
        </div>
        <div className={styles.etaPanel}><span>예상 도착</span><strong>{selectedHospital?.eta ?? "경로 조회 전"}</strong><small>{selectedHospital?.name ?? "이송지 미확정"}</small></div>
      </section>
      <section className={styles.transportStatus}>
        <div><span>이송 시작</span><strong>{timeFor("이송 시작")}</strong></div>
        <div><span>최근 갱신</span><strong>{state.reassessmentSaved ? timeFor("이송 중 재평가", "이송 전 재평가 확인", "추가정보 회신") : timeFor("이송 시작")}</strong></div>
        <div><span>상태 공유</span><strong>{state.reassessmentSaved ? "병원 전달됨" : "최초 상태"}</strong></div>
      </section>
      <section className={styles.recheckCard}>
        <div className={styles.sectionTitle}><div><Activity size={18} /><strong>최근 재평가</strong></div><StatusBadge tone={state.reassessmentSaved ? "green" : "slate"}>{state.reassessmentSaved ? "저장됨" : "미기록"}</StatusBadge></div>
        <div className={styles.recheckValues}><span>AVPU <b>A</b></span><span>BP <b>{state.reassessmentVitals?.bp ?? "—"}</b> mmHg</span><span>SpO₂ <b>{state.reassessmentVitals ? `${state.reassessmentVitals.spo2}%` : "—"}</b></span><span>증상 <b>{state.reassessmentSaved ? state.reassessmentSummary : "확인 전"}</b></span></div>
        {!state.reassessmentSaved && (
          <>
            <button
              className={styles.pttButton}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={finishVoice}
              onKeyDown={handleVoiceKeyDown}
              onKeyUp={handleVoiceKeyUp}
            ><Mic size={18} /> 재평가 누르고 말하기</button>
            <button onClick={() => setShowReassessmentForm((current) => !current)}><RefreshCw size={17} /> 측정값 직접 입력</button>
            {showReassessmentForm && (
              <div className={styles.reassessmentForm}>
                {vitalFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <div><input value={reassessmentDraft[field.key]} onChange={(event) => setReassessmentDraft((current) => ({ ...current, [field.key]: event.target.value }))} /><small>{field.unit}</small></div>
                  </label>
                ))}
                <label className={styles.trendField}><span>증상 변화</span><input value={reassessmentTrend} onChange={(event) => setReassessmentTrend(event.target.value)} /></label>
                <button className={styles.saveReassessment} onClick={() => {
                  dispatch({ type: "SAVE_REASSESSMENT", values: reassessmentDraft, symptomTrend: reassessmentTrend });
                  setShowReassessmentForm(false);
                }}><Check size={17} /> 측정시각과 함께 저장</button>
              </div>
            )}
          </>
        )}
      </section>
      <button className={styles.fullAction} onClick={() => { transition("hospital-arrived", "구급대원", "병원 도착", `${selectedHospital?.name} · GPS 및 사용자 확인`, "teal"); setTab("handoff"); }}>
        <Hospital size={19} /> 병원 도착
      </button>
    </>
  );

  const renderHandoff = () => (
    <>
      <section className={styles.handoffHero} data-complete={state.stage === "complete"}>
        <span>{state.stage === "complete" ? <CheckCircle2 size={30} /> : <ClipboardCheck size={30} />}</span>
        <div><small>{state.stage === "complete" ? "환자 인수 완료" : state.stage === "handoff-sent" ? "병원 인수 확인 대기" : `병원 도착 ${timeFor("병원 도착")}`}</small><h1>{state.stage === "complete" ? "인계가 완료되었습니다" : "최종 인계 내용을 확인하세요"}</h1><p>{selectedHospital?.name}</p></div>
      </section>
      <section className={styles.handoffCard}>
        <div className={styles.sectionTitle}><div><FileText size={18} /><strong>구두·전자 인계 카드</strong></div><SourceTag tone="confirmed">최종 확인본</SourceTag></div>
        <dl>
          <div><dt>환자</dt><dd>{SCENARIO.patient} · {SCENARIO.living}</dd></div>
          <div><dt>주증상</dt><dd>{SCENARIO.chiefComplaint}</dd></div>
          <div><dt>발생시각</dt><dd>{SCENARIO.onset} · {SCENARIO.onsetSource}</dd></div>
          <div><dt>동반증상</dt><dd>{SCENARIO.symptoms.join(" · ")}</dd></div>
          <div><dt>최초 활력</dt><dd>BP {state.vitals.bp} · PR {state.vitals.pr} · SpO₂ {state.vitals.spo2}%</dd></div>
          <div><dt>재평가</dt><dd>{state.reassessmentVitals ? `AVPU A · BP ${state.reassessmentVitals.bp} · SpO₂ ${state.reassessmentVitals.spo2}% · ${state.reassessmentSummary}` : "추가 기록 없음"}</dd></div>
          <div><dt>처치</dt><dd>{CARDIO_DEMO_HANDOFF.sections.treatment.join(" · ")}</dd></div>
          <div><dt>미상 항목</dt><dd>{SCENARIO.unresolvedItems.join(" · ")}</dd></div>
        </dl>
      </section>
      {state.stage === "hospital-arrived" && (
        <button className={styles.fullAction} onClick={() => dispatch({ type: "SET_HANDOFF", receiver: "", role: "간호사" })}>
          <Send size={19} /> 구두·전자 인계 완료
        </button>
      )}
      {state.stage === "handoff-sent" && <div className={styles.waitingBox}><span className={styles.pulseDot} /><div><strong>병원 인수 확인을 기다리고 있습니다</strong><small>병원 담당자가 인수해야 사건이 종료됩니다.</small></div></div>}
      {state.stage === "complete" && (
        <>
          <section className={styles.completeDetails}>
            <div><span>인수자</span><strong>{state.handoffRole} {state.handoffReceiver}</strong></div>
            <div><span>인수시각</span><strong>{timeFor("환자 인수 확인")}</strong></div>
            <div><span>사건상태</span><strong>환자 인수 완료</strong></div>
          </section>
          <button className={styles.fullAction} onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("view", "report");
            window.location.assign(url.toString());
          }}><FileText size={19} /> 구급활동 기록 검토</button>
        </>
      )}
    </>
  );

  const renderActiveContent = () => {
    if (tab === "patient") return renderPatientSummary();
    if (tab === "hospital") return renderHospitalStatus();
    if (tab === "handoff") return renderHandoff();
    if (state.stage === "transporting") return renderTransport();
    return renderFieldAssessment();
  };

  const renderTabs = () => (
    <nav className={styles.bottomTabs} aria-label="구급대 업무 메뉴">
      <button className={tab === "field" ? styles.tabActive : ""} onClick={() => setTab("field")}><HeartPulse size={18} /><span>{state.stage === "transporting" ? "이송" : "현장"}</span></button>
      <button className={tab === "patient" ? styles.tabActive : ""} onClick={() => setTab("patient")}><UserRound size={18} /><span>환자</span></button>
      <button className={tab === "hospital" ? styles.tabActive : ""} onClick={() => setTab("hospital")}><Hospital size={18} /><span>병원</span>{state.stage === "info-requested" || state.stage === "accepted" ? <i /> : null}</button>
      <button className={tab === "handoff" ? styles.tabActive : ""} onClick={() => setTab("handoff")} disabled={!stageAtLeast(state.stage, "hospital-arrived")}><ClipboardCheck size={18} /><span>인계</span></button>
    </nav>
  );

  let body: React.ReactNode;
  if (state.stage === "assigned" && !caseOpen) body = renderCaseList();
  else if (state.stage === "assigned" || state.stage === "enroute") body = renderDispatch();
  else if (state.stage === "scene-arrived") body = renderArrival();
  else body = (
    <>
      {contextHeader(tab === "field" ? (state.stage === "transporting" ? "이송 중" : "현장평가") : tab === "patient" ? "환자 확인본" : tab === "hospital" ? "병원 진행" : "환자 인계")}
      <main className={styles.phoneScroll}>{renderActiveContent()}</main>
      {renderTabs()}
    </>
  );

  return (
    <div className={styles.mobileStage}>
      <section className={styles.device} aria-label="EMS Relay 구급대원 모바일 화면">
        {phoneHeader}
        {body}
        {toast && <div className={styles.toast} role="status"><CheckCircle2 size={18} /> {toast}</div>}

        {callingHospital && (
          <div className={styles.callOverlay} role="dialog" aria-modal="true" aria-label={`${callingHospital.name} 전화 연결`}>
            <section className={styles.callSheet}>
              <button className={styles.callClose} aria-label="전화 연결 닫기" onClick={() => setCallingHospitalId(null)}><X size={18} /></button>
              <span className={styles.callIcon}><Phone size={24} /></span>
              <small>수용 문의 전화</small>
              <h2>{callingHospital.name}</h2>
              <div className={styles.callSummary}>
                <span><strong>{SCENARIO.patient}</strong><small>{SCENARIO.chiefComplaint}</small></span>
                <span><strong>발생 {SCENARIO.onset}</strong><small>{SCENARIO.symptoms.join(" · ")}</small></span>
              </div>
              <p className={styles.callHint}><AlertTriangle size={15} /> 전화 연결만으로 수용 확정이 아닙니다. 병원의 수용 가능 회신을 별도로 확인하세요.</p>
              <div className={styles.callResults}>
                <button onClick={() => {
                  dispatch({ type: "CALL_HOSPITAL", hospitalId: callingHospital.id, result: "응답 없음" });
                  setCallingHospitalId(null);
                  notify("응답 없음으로 통화 기록을 남겼습니다.");
                }}>응답 없음</button>
                <button onClick={() => {
                  dispatch({ type: "CALL_HOSPITAL", hospitalId: callingHospital.id, result: "연결됨 · 수용 여부 미확정" });
                  setCallingHospitalId(null);
                  notify("연결됨으로 통화 기록을 남겼습니다.");
                }}><Phone size={17} /> 연결됨</button>
              </div>
            </section>
          </div>
        )}

        {voiceMode && (
          <div className={styles.voiceOverlay} role="dialog" aria-modal="true" aria-label="음성으로 환자 상태 기록" aria-busy={voiceMode === "processing"} onPointerUp={() => { if (voiceModeRef.current === "listening") finishVoice(); }} onPointerCancel={() => { if (voiceModeRef.current === "listening") finishVoice(); }}>
            <button className={styles.voiceClose} aria-label="음성 입력 닫기" onClick={cancelVoice}><X size={19} /></button>
            {voiceMode === "listening" ? (
              <div className={styles.listeningPanel}>
                <span className={styles.micPulse}><Mic size={27} /></span>
                <h2>듣고 있습니다</h2>
                <p>환자를 보면서 평소 말하듯 말씀하세요.</p>
                <div className={styles.liveTranscript}>{transcriptSteps[transcriptIndex]}<i /></div>
                <button
                  onPointerUp={handlePointerUp}
                  onPointerCancel={finishVoice}
                  onKeyUp={handleVoiceKeyUp}
                >손을 떼면 내용 확인</button>
              </div>
            ) : voiceMode === "processing" ? (
              <div className={styles.listeningPanel} role="status" aria-live="polite">
                <span className={styles.micPulse}><Activity size={27} /></span>
                <h2>환자 상태를 정리하고 있습니다</h2>
                <p>말한 내용을 구조화하고 확인할 항목을 준비합니다.</p>
                <div className={styles.liveTranscript}>{nextPttUpdate?.transcript ?? "입력 내용을 확인하고 있습니다."}</div>
                <button onClick={cancelVoice}>처리 취소</button>
              </div>
            ) : voiceResult ? (
              <div className={styles.voiceReview}>
                <span className={styles.reviewIcon}><ClipboardCheck size={25} /></span>
                <h2>{voiceResult.update.title} 변경안을 확인하세요</h2>
                <p>말한 내용에서 정리한 항목입니다. 선택한 값만 구급대원 확인 정보로 반영됩니다.</p>
                <div className={styles.transcriptBox}>“{voiceResult.update.transcript}”</div>
                <div className={styles.extractedList}>
                  {voiceResult.update.proposals.map((proposal) => {
                    const accepted = acceptedProposalIds.includes(proposal.id);
                    return (
                      <button
                        className={accepted ? styles.choiceActive : ""}
                        onClick={() => setAcceptedProposalIds((current) => current.includes(proposal.id) ? current.filter((id) => id !== proposal.id) : [...current, proposal.id])}
                        key={proposal.id}
                        aria-pressed={accepted}
                      >
                        <span>{proposal.label}</span>
                        <strong>{proposal.displayValue}</strong>
                        <SourceTag tone={reviewTone(proposal.status)}>{proposal.status === "unknown" ? "미상" : proposal.status === "unconfirmed" ? "진술 기반" : proposal.status === "pending_review" ? "판단 확인" : "확인 후보"}</SourceTag>
                      </button>
                    );
                  })}
                </div>
                <div className={styles.reviewActions}>
                  <button onClick={cancelVoice}>취소</button>
                  <button disabled={!acceptedProposalIds.length} onClick={() => {
                    const allIds = voiceResult.update.proposals.map((proposal) => proposal.id);
                    dispatch({
                      type: "CONFIRM_PTT",
                      updateId: voiceResult.update.id,
                      acceptedProposalIds,
                      rejectedProposalIds: allIds.filter((id) => !acceptedProposalIds.includes(id)),
                    });
                    setVoicePhase(null);
                    setVoiceResult(null);
                    notify(`${acceptedProposalIds.length}개 항목을 확인값으로 반영했습니다.`);
                  }}><Check size={18} /> 선택 항목 반영</button>
                </div>
              </div>
            ) : (
              <div className={styles.listeningPanel}><AlertTriangle size={28} /><h2>변경안을 불러오지 못했습니다</h2><p>기존 환자정보는 변경되지 않았습니다.</p><button onClick={cancelVoice}>닫기</button></div>
            )}
          </div>
        )}
      </section>

      <aside className={styles.mobileGuide}>
        <span className={styles.guideKicker}>현재 단계</span>
        <h2>{STAGE_LABEL[state.stage]}</h2>
        <p>구급대원이 확인한 정보와 버튼 입력 시각만 공통 사건에 반영됩니다.</p>
        <div className={styles.guidePatient}>
          <span><UserRound size={18} /></span>
          <div><strong>{state.stage === "assigned" || state.stage === "enroute" ? SCENARIO.reportedPatient : SCENARIO.patient}</strong><small>{state.stage === "assigned" || state.stage === "enroute" ? SCENARIO.reportedComplaint : SCENARIO.chiefComplaint}</small></div>
        </div>
        <div className={styles.guideEvents}>
          {[...state.events].reverse().slice(0, 4).map((event) => (
            <div key={event.id}><time>{event.time}</time><span><strong>{event.title}</strong><small>{event.actor}</small></span></div>
          ))}
        </div>
        <div className={styles.guideRule}><ShieldCheck size={17} /><span><strong>확인한 값만 반영됩니다</strong><small>말한 내용은 변경안으로 정리되고 구급대원이 확인해야 저장됩니다.</small></span></div>
      </aside>
    </div>
  );
}
