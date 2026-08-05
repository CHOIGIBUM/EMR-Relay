"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Hospital as HospitalIcon,
  MapPin,
  Navigation,
  RadioTower,
  RefreshCw,
  Route,
  Search,
  ScanSearch,
  UserRound,
  X,
} from "lucide-react";
import KakaoRouteMap from "./KakaoRouteMap";
import {
  DEMO_RESET_CONFIRMATION,
  type DispatchCase,
  type HospitalRequest,
  type PatientAssessment,
  type StrokeSide,
  type SpeechFinding,
  type VoiceUpdateFocus,
} from "@/lib/v2/types";
import { applyVoiceChangesToAssessment } from "@/lib/v2/voiceProposal";
import { getDispatchRoute } from "@/lib/v2/dispatchRoutes";
import { buildKakaoDirectionsLink } from "@/lib/v2/map";
import Brand from "./Brand";
import PatientCard from "./PatientCard";
import PttInput from "./PttInput";
import WheelPicker from "./WheelPicker";
import HospitalMatchMap from "./HospitalMatchMap";
import { useV2 } from "./V2Provider";
import styles from "./V2.module.css";

const stageLabel = {
  assigned: "출동 배정",
  enroute: "현장 이동",
  "scene-arrived": "현장 도착",
  "patient-contact": "환자 접촉",
  assessing: "환자 평가",
  "card-confirmed": "환자 카드",
  matching: "병원 요청",
  "destination-selected": "이송지 확인",
  transporting: "병원 이동",
  arrived: "이송 완료",
} as const;

const choiceText = {
  normal: "정상",
  left: "좌측",
  right: "우측",
  unassessable: "평가 불가",
} as const;

const MAX_MATCH_RADIUS_KM = 120;

function nextMatchRadius(radiusKm: number) {
  if (radiusKm >= MAX_MATCH_RADIUS_KM) return undefined;
  return Math.min(MAX_MATCH_RADIUS_KM, Math.max(radiusKm + 10, radiusKm * 2));
}

const assessmentStepFields: ReadonlyArray<ReadonlyArray<keyof PatientAssessment>> = [
  ["age", "sex", "airway", "breathing", "circulation", "avpu", "chiefComplaint"],
  ["face", "arm", "speech"],
  ["systolicBp", "diastolicBp", "pulse", "respiratoryRate", "spo2", "glucose", "lastKnownWell", "lastKnownWellBasis", "firstAbnormalTime", "measuredAt"],
];

const assessmentFieldLabels: Partial<Record<keyof PatientAssessment, string>> = {
  age: "나이", sex: "성별", airway: "기도", breathing: "호흡", circulation: "순환", avpu: "의식 수준", chiefComplaint: "주호소",
  face: "안면 마비", arm: "팔 떨어짐", speech: "언어 이상",
  systolicBp: "수축기 혈압", diastolicBp: "이완기 혈압", pulse: "맥박", respiratoryRate: "호흡수", spo2: "SpO₂", glucose: "혈당",
  lastKnownWell: "마지막 정상 확인", lastKnownWellBasis: "마지막 정상 확인 근거", firstAbnormalTime: "최초 이상 발견", measuredAt: "활력 측정 시각",
};

function missingAssessmentFields(draft: PatientAssessment, step: number) {
  return (assessmentStepFields[step] ?? []).filter((field) => {
    const value = draft[field];
    return typeof value === "string" ? !value.trim() : value === undefined || value === null;
  });
}

function Choice<T extends string>({ label, value, items, onChange }: { label: string; value?: T; items: Array<{ value: T; label: string }>; onChange(value: T): void }) {
  return (
    <fieldset className={styles.choice}>
      <legend>{label}</legend>
      <div>{items.map((item) => <button type="button" key={item.value} data-active={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>
    </fieldset>
  );
}

function formatTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function isClockTime(value?: string) {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function assessmentStepComplete(draft: PatientAssessment, step: number) {
  if (missingAssessmentFields(draft, step).length) return false;
  if (step !== 2) return true;
  return Boolean(isClockTime(draft.lastKnownWell) && isClockTime(draft.firstAbnormalTime) && isClockTime(draft.measuredAt));
}

export default function ParamedicApp() {
  const { api, store, loading, pending, error, run, refresh, resetDemoCases } = useV2();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentStep, setAssessmentStep] = useState(0);
  const [assessmentMaxStep, setAssessmentMaxStep] = useState(0);
  const [draft, setDraft] = useState<PatientAssessment>({});
  const [validation, setValidation] = useState<string | null>(null);
  const [matchingRequestedId, setMatchingRequestedId] = useState<string | null>(null);
  const [rangeNotice, setRangeNotice] = useState<string | null>(null);
  const [acceptanceAlert, setAcceptanceAlert] = useState<string | null>(null);
  const acceptedTrackingReadyRef = useRef(false);
  const acceptedRequestIdsRef = useRef(new Set<string>());
  const alertTimerRef = useRef<number | null>(null);
  const incident = store?.cases.find((item) => item.id === selectedId) ?? null;
  const requests = useMemo(() => store?.requests.filter((item) => item.caseId === selectedId) ?? [], [selectedId, store?.requests]);
  const accepted = useMemo(() => requests.filter((request) => request.status === "ACCEPTED"), [requests]);
  const matchingState = incident?.matchingState ?? null;
  const explicitRadii = requests.flatMap((request) => request.radiusKm === undefined ? [] : [request.radiusKm]);
  const requestRadius = explicitRadii.length
    ? Math.max(...explicitRadii)
    : Math.max(15, ...requests.map((request) => Math.ceil(request.distanceKm / 5) * 5));
  const currentMatchRadius = matchingState?.currentRadiusKm ?? requestRadius;
  const nextRadius = accepted.length
    ? undefined
    : matchingState
      ? matchingState.nextRadiusKm
      : nextMatchRadius(currentMatchRadius);
  const expansionQueued = matchingState?.status === "QUEUED" || matchingState?.status === "EXPANSION_QUEUED";
  const matchMarkers = useMemo(() => requests.flatMap((request) => {
    const hospital = store?.hospitals.find((item) => item.id === request.hospitalId);
    const location = hospital?.location ?? request.hospitalLocation;
    const name = hospital?.name ?? request.hospitalName;
    return location && name ? [{
      id: request.id,
      name,
      address: hospital?.address ?? request.hospitalAddress,
      location,
      status: request.status,
      distanceKm: request.distanceKm,
      etaMinutes: request.etaMinutes,
    }] : [];
  }), [requests, store?.hospitals]);
  const destinationRequest = requests.find((request) => request.id === incident?.destinationRequestId) ?? null;
  const destinationHospital = store?.hospitals.find((hospital) => hospital.id === destinationRequest?.hospitalId) ?? null;
  const destinationName = destinationHospital?.name ?? destinationRequest?.hospitalName ?? destinationRequest?.hospitalId ?? "선택 병원";
  const destinationLocation = destinationHospital?.location ?? destinationRequest?.hospitalLocation;
  const destinationAddress = destinationHospital?.address ?? destinationRequest?.hospitalAddress;

  const allAccepted = useMemo(
    () => store?.requests.filter((request) => request.status === "ACCEPTED") ?? [],
    [store?.requests],
  );
  const allAcceptedIdsKey = allAccepted.map((request) => request.id).sort().join("|");
  useEffect(() => {
    if (!store) return;
    const currentIds = new Set(allAcceptedIdsKey.split("|").filter(Boolean));
    if (!acceptedTrackingReadyRef.current) {
      acceptedTrackingReadyRef.current = true;
      acceptedRequestIdsRef.current = currentIds;
      return;
    }
    const newlyAccepted = allAccepted.filter((request) => !acceptedRequestIdsRef.current.has(request.id));
    acceptedRequestIdsRef.current = currentIds;
    if (!newlyAccepted.length) return;
    const message = newlyAccepted.map((request) => {
      const caseCode = store.cases.find((incident) => incident.id === request.caseId)?.code ?? request.caseId;
      return `${caseCode} · ${request.hospitalName ?? request.hospitalId}`;
    }).join(" / ");
    setAcceptanceAlert(message);
    setRangeNotice(null);
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    alertTimerRef.current = window.setTimeout(() => setAcceptanceAlert(null), 6_000);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("EMS Relay 병원 수용 회신", { body: message, tag: `ems-relay-${newlyAccepted.map((request) => request.id).join("-")}` });
      } catch { /* The in-app toast remains the primary notification. */ }
    }
    if ("vibrate" in navigator) navigator.vibrate([180, 90, 180]);
  }, [allAccepted, allAcceptedIdsKey, store]);

  useEffect(() => () => {
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
  }, []);

  const goHome = () => {
    setSelectedId(null);
    setAssessmentOpen(false);
    setAssessmentStep(0);
    setAssessmentMaxStep(0);
    setValidation(null);
    setMatchingRequestedId(null);
    setRangeNotice(null);
    setAcceptanceAlert(null);
  };

  const openCase = (item: DispatchCase) => {
    setSelectedId(item.id);
    setDraft({ ...item.assessment });
    setAssessmentOpen(item.stage === "patient-contact" || item.stage === "assessing");
    setAssessmentStep(0);
    setAssessmentMaxStep(item.stage === "assessing" ? 2 : 0);
    setValidation(null);
  };

  const beginAssessment = () => {
    if (!incident) return;
    setDraft({ ...incident.assessment });
    setAssessmentStep(0);
    setAssessmentMaxStep(0);
    setAssessmentOpen(true);
    setValidation(null);
  };

  const doRun = async (operation: () => Promise<unknown>) => {
    try { await run(operation); } catch { /* V2Provider renders the message. */ }
  };

  const contactAndAssess = async () => {
    if (!incident) return;
    try {
      await run(() => api.contactPatient(incident.id));
      beginAssessment();
    } catch { /* V2Provider renders the message. */ }
  };

  const resetDemo = async () => {
    if (!window.confirm("출동 사건 3건을 처음 상태로 되돌릴까요? 현재 입력과 병원 회신은 삭제됩니다.")) return;
    try {
      await resetDemoCases(DEMO_RESET_CONFIRMATION);
      goHome();
    } catch { /* V2Provider renders the message. */ }
  };

  const beginMatching = async () => {
    if (!incident) return;
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
    setMatchingRequestedId(incident.id);
    try {
      await run(() => api.startMatching(incident.id));
    } catch {
      setMatchingRequestedId((current) => current === incident.id ? null : current);
    }
  };

  const requestRangeExpansion = async () => {
    if (!incident || accepted.length || !nextRadius) return;
    try {
      await run(() => api.expandMatching(incident.id));
      setRangeNotice(`요청 범위를 확대했습니다. 최대 ${nextRadius}km 후보를 확인합니다.`);
    } catch { /* V2Provider renders the message. */ }
  };

  const selectDestination = async (request: HospitalRequest) => {
    if (!incident || request.status !== "ACCEPTED") return;
    try {
      await run(() => api.selectDestination(incident.id, request.id));
      setMatchingRequestedId(null);
      setRangeNotice(null);
      setAcceptanceAlert(null);
    } catch { /* V2Provider renders the message. */ }
  };

  const validateStep = (step = assessmentStep) => {
    const missing = missingAssessmentFields(draft, step);
    const invalidTimes = step === 2
      ? [
        draft.lastKnownWell && !isClockTime(draft.lastKnownWell) ? "마지막 정상 확인(HH:MM)" : null,
        draft.firstAbnormalTime && !isClockTime(draft.firstAbnormalTime) ? "최초 이상 발견(HH:MM)" : null,
        draft.measuredAt && !isClockTime(draft.measuredAt) ? "활력 측정 시각(HH:MM)" : null,
      ].filter(Boolean) as string[]
      : [];
    const labels = [...missing.map((field) => assessmentFieldLabels[field] ?? field), ...invalidTimes];
    if (labels.length) {
      setValidation(`입력 필요: ${labels.join(", ")}`);
      return false;
    }
    setValidation(null);
    return true;
  };

  const nextAssessment = async () => {
    if (!incident || !validateStep()) return;
    if (assessmentStep < 2) {
      const nextStep = assessmentStep + 1;
      setAssessmentStep(nextStep);
      setAssessmentMaxStep((current) => Math.max(current, nextStep));
      return;
    }
    const incompleteStep = [0, 1, 2].find((step) => !assessmentStepComplete(draft, step));
    if (incompleteStep !== undefined) {
      setAssessmentStep(incompleteStep);
      validateStep(incompleteStep);
      return;
    }
    try {
      await run(async () => {
        await api.saveAssessment(incident.id, draft);
        await api.confirmPatientCard(incident.id);
      });
      setAssessmentOpen(false);
    } catch (reason) {
      setValidation(reason instanceof Error ? `저장 실패: ${reason.message}` : "저장하지 못했습니다. 입력값을 다시 확인해 주세요.");
    }
  };

  if (error && !store) return (
    <main className={styles.mobileShell}>
      <div className={styles.mobileApp}>
        <Brand mobile subtitle="구급대원" />
        <div className={styles.loadFailure} role="alert">
          <AlertTriangle />
          <strong>출동 정보를 불러오지 못했습니다</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}><RefreshCw /> 다시 시도</button>
        </div>
      </div>
    </main>
  );
  if (loading || !store) return <main className={styles.mobileShell}><div className={styles.mobileApp}><Brand mobile subtitle="구급대원" /><div className={styles.loading}>출동 정보를 불러오고 있습니다.</div></div></main>;

  const renderCaseList = () => (
    <div className={styles.mobilePage}>
      <div className={styles.pageTitle}><div><small>현재 배정</small><h1>출동 사건 {store.cases.length}건</h1></div><button type="button" onClick={() => void refresh()} aria-label="새로고침"><RefreshCw /></button></div>
      <div className={styles.caseList}>
        {store.cases.map((item) => (
          <button type="button" className={styles.caseCard} key={item.id} onClick={() => openCase(item)}>
            <div><strong>{item.code}</strong><span><Clock3 /> {item.reportTime}</span></div>
            <h2>{item.reportSummary}</h2>
            <p><MapPin /> {item.sceneAddress}</p>
            <footer><span>{stageLabel[item.stage]}</span><small>{item.dispatchUnit}</small><ChevronRight /></footer>
          </button>
        ))}
      </div>
    </div>
  );

  const pageBar = (title: string, back?: () => void) => (
    <div className={styles.mobilePageBar}>
      <button type="button" onClick={back ?? goHome} aria-label="뒤로"><ArrowLeft /></button>
      <div><h1>{title}</h1><span>{incident?.code}</span></div>
      <b>{incident ? stageLabel[incident.stage] : ""}</b>
    </div>
  );

  const renderDispatch = () => {
    if (!incident) return null;
    const enroute = incident.stage === "enroute";
    const arrived = incident.stage === "scene-arrived";
    const dispatchRoute = getDispatchRoute(incident.id);
    return (
      <div className={styles.mobilePageAction}>
        {pageBar(enroute ? "현장 이동" : arrived ? "현장 도착" : "출동 준비")}
        <div className={styles.mobileScroll}>
          <section className={styles.dispatchBrief}>
            <div className={styles.dispatchId}><span>출동 사건</span><strong>{incident.code}</strong></div>
            <h2>{incident.reportSummary}</h2>
            {(incident.estimatedAge || incident.estimatedSex) ? <small className={styles.reportEstimate}>신고 단계 추정 · {incident.estimatedAge} {incident.estimatedSex} · 현장 미확인</small> : null}
            <p><MapPin /> {incident.sceneAddress}</p>
            <div className={styles.callerBrief}><span><UserRound /> 신고자 {incident.reporter}</span><span><Clock3 /> 접수 {incident.reportTime}</span></div>
          </section>
          {incident.stage !== "assigned" && dispatchRoute ? <section className={styles.dispatchRoute}>
            <header><div><small>카카오 출동 경로</small><strong>{dispatchRoute.stationName} → 현장</strong></div><span>{dispatchRoute.etaMinutes}분 · {dispatchRoute.distanceKm.toFixed(1)}km</span></header>
            <KakaoRouteMap origin={dispatchRoute.origin} destination={incident.scene} originName={dispatchRoute.stationName} destinationName={incident.sceneAddress} />
            <p className={styles.dispatchOriginAddress}>{dispatchRoute.stationAddress}</p>
          </section> : null}
          <div className={styles.progress}>
            {[
              ["신고 접수", true, incident.reportTime],
              ["출동 시작", incident.stage !== "assigned", formatTime(incident.timeline.dispatchStartedAt)],
              ["현장 도착", arrived, formatTime(incident.timeline.sceneArrivedAt)],
            ].map(([label, done, time], index) => <div key={String(label)} data-done={done}><i>{done ? <Check /> : index + 1}</i><strong>{label}</strong><small>{time}</small></div>)}
          </div>
        </div>
        <div className={styles.stickyAction}>
          {incident.stage === "assigned" ? <button disabled={pending} onClick={() => void doRun(() => api.startDispatch(incident.id))}><Ambulance /> 출동 시작</button> : null}
          {incident.stage === "enroute" ? <button disabled={pending} onClick={() => void doRun(() => api.arriveScene(incident.id))}><MapPin /> 현장 도착</button> : null}
          {incident.stage === "scene-arrived" ? <button disabled={pending} onClick={() => void contactAndAssess()}><UserRound /> 환자 접촉</button> : null}
        </div>
      </div>
    );
  };

  const renderAssessment = () => {
    if (!incident) return null;
    const update = <K extends keyof PatientAssessment>(field: K, value: PatientAssessment[K]) => setDraft((current) => ({ ...current, [field]: value }));
    const voiceFocus: VoiceUpdateFocus = assessmentStep === 0 ? "BASIC" : assessmentStep === 1 ? "CPSS" : "VITALS";
    return (
      <div className={styles.mobilePageAction}>
        <div className={styles.assessmentHeader}>
          {pageBar("환자 상태 입력", () => { setAssessmentOpen(false); setValidation(null); })}
          <nav className={styles.assessmentNav} aria-label="환자 상태 입력 단계">{["기본", "CPSS", "활력·시간"].map((label, index) => <button key={label} type="button" disabled={index > assessmentMaxStep} aria-current={assessmentStep === index ? "step" : undefined} data-active={assessmentStep === index} onClick={() => { setAssessmentStep(index); setValidation(null); }}><i>{index + 1}</i>{label}</button>)}</nav>
        </div>
        <div className={styles.mobileScroll}>
          <PttInput
            key={`voice-step-${assessmentStep}`}
            caseId={incident.id}
            value={draft.voiceNote ?? ""}
            focus={voiceFocus}
            onChange={(value) => update("voiceNote", value)}
            onApply={(changes) => setDraft((current) => applyVoiceChangesToAssessment(current, changes))}
          />
          {assessmentStep === 0 ? <section className={styles.formSection}>
            <h2>환자 기본 확인</h2>
            <WheelPicker label="나이" value={draft.age} min={0} max={130} unit="세" onChange={(value) => update("age", value)} />
            <Choice label="성별" value={draft.sex} items={[{ value: "female", label: "여성" }, { value: "male", label: "남성" }, { value: "unknown", label: "미상" }]} onChange={(value) => update("sex", value)} />
            <Choice label="기도" value={draft.airway} items={[{ value: "patent", label: "개방" }, { value: "at-risk", label: "확보 필요" }]} onChange={(value) => update("airway", value)} />
            <Choice label="호흡" value={draft.breathing} items={[{ value: "adequate", label: "자발호흡" }, { value: "inadequate", label: "호흡 이상" }]} onChange={(value) => update("breathing", value)} />
            <Choice label="순환" value={draft.circulation} items={[{ value: "stable", label: "맥박 촉지" }, { value: "poor-perfusion", label: "순환 불안정" }]} onChange={(value) => update("circulation", value)} />
            <Choice label="의식 수준(AVPU)" value={draft.avpu} items={[{ value: "A", label: "A 명료" }, { value: "V", label: "V 음성" }, { value: "P", label: "P 통증" }, { value: "U", label: "U 무반응" }]} onChange={(value) => update("avpu", value)} />
            <label className={styles.textInput}><span>주호소</span><textarea rows={3} value={draft.chiefComplaint ?? ""} onChange={(event) => update("chiefComplaint", event.target.value)} placeholder="환자에게서 직접 확인한 증상" /></label>
          </section> : null}
          {assessmentStep === 1 ? <section className={styles.formSection}>
            <div className={styles.sectionHeading}><div><small>뇌졸중 선별검사</small><h2>CPSS</h2></div><Activity /></div>
            <Choice<StrokeSide> label="안면 마비" value={draft.face} items={Object.entries(choiceText).map(([value, label]) => ({ value: value as StrokeSide, label }))} onChange={(value) => update("face", value)} />
            <Choice<StrokeSide> label="팔 떨어짐" value={draft.arm} items={Object.entries(choiceText).map(([value, label]) => ({ value: value as StrokeSide, label }))} onChange={(value) => update("arm", value)} />
            <Choice<SpeechFinding> label="언어 이상" value={draft.speech} items={[{ value: "normal", label: "정상" }, { value: "dysarthria", label: "구음장애" }, { value: "aphasia", label: "실어증" }, { value: "unassessable", label: "평가 불가" }]} onChange={(value) => update("speech", value)} />
          </section> : null}
          {assessmentStep === 2 ? <section className={styles.formSection}>
            <h2>활력징후와 시간</h2>
            <div className={styles.wheelGrid}>
              <WheelPicker label="수축기 혈압" value={draft.systolicBp} min={20} max={300} unit="mmHg" onChange={(value) => update("systolicBp", value)} />
              <WheelPicker label="이완기 혈압" value={draft.diastolicBp} min={10} max={200} unit="mmHg" onChange={(value) => update("diastolicBp", value)} />
              <WheelPicker label="맥박" value={draft.pulse} min={0} max={300} unit="회/분" onChange={(value) => update("pulse", value)} />
              <WheelPicker label="호흡수" value={draft.respiratoryRate} min={0} max={100} unit="회/분" onChange={(value) => update("respiratoryRate", value)} />
              <WheelPicker label="SpO₂" value={draft.spo2} min={0} max={100} unit="%" onChange={(value) => update("spo2", value)} />
              <WheelPicker label="혈당" value={draft.glucose} min={10} max={1000} unit="mg/dL" onChange={(value) => update("glucose", value)} />
            </div>
            {draft.glucose !== undefined && draft.glucose < 60 ? <div className={styles.warning}><AlertTriangle /><span><strong>혈당 60 mg/dL 미만</strong>저혈당 처치 후 신경학적 상태를 다시 확인하세요.</span></div> : null}
            <div className={styles.timeInputs}>
              <label>마지막 정상 확인<input type="time" value={draft.lastKnownWell ?? ""} onChange={(event) => update("lastKnownWell", event.target.value)} /></label>
              <label>마지막 정상 확인 근거<input value={draft.lastKnownWellBasis ?? ""} onChange={(event) => update("lastKnownWellBasis", event.target.value)} placeholder="보호자 목격·통화 등" /></label>
              <label>최초 이상 발견<input type="time" value={draft.firstAbnormalTime ?? ""} onChange={(event) => update("firstAbnormalTime", event.target.value)} /></label>
              <label>활력 측정 시각<input type="time" value={draft.measuredAt ?? ""} onChange={(event) => update("measuredAt", event.target.value)} /></label>
            </div>
          </section> : null}
        </div>
        <div className={styles.assessmentFooter}>
          {validation ? <p className={styles.stickyFormError} role="alert">{validation}</p> : null}
          <div className={styles.stickyAction}><button disabled={pending} onClick={() => void nextAssessment()}>{assessmentStep < 2 ? <>다음 확인 <ChevronRight /></> : <>환자 카드 확정 <Check /></>}</button></div>
        </div>
      </div>
    );
  };

  const renderCard = () => incident?.patientCard ? (
    <div className={styles.mobilePageAction}>
      {pageBar("환자 카드")}
      <div className={styles.mobileScroll}><PatientCard card={incident.patientCard} /></div>
      <div className={styles.stickyAction}><button disabled={pending} onClick={() => void beginMatching()}><Search /> 근거리 병원 동시 요청</button></div>
    </div>
  ) : null;

  const renderMatching = () => {
    if (!incident || !store) return null;
    return (
      <div className={styles.mobilePageAction}>
        {pageBar("병원 요청", () => undefined)}
        <div className={styles.mobileScroll}>
          <HospitalMatchMap
            scene={incident.scene}
            sceneAddress={incident.sceneAddress}
            radiusKm={currentMatchRadius}
            nextRadiusKm={nextRadius}
            nextExpansionAt={matchingState?.nextExpansionAt}
            expansionReason={matchingState?.expansionReason}
            matchingStatus={matchingState?.status}
            expanding={!accepted.length && Boolean(nextRadius)}
            markers={matchMarkers}
          />
          {rangeNotice ? <p className={styles.rangeActionNotice} role="status">{rangeNotice}</p> : null}
          {accepted.length ? <section className={styles.matchNotice}><CheckCircle2 /><div><small>수용 가능 회신 {accepted.length}곳</small><strong>최종 이송병원을 선택하세요</strong></div></section> : null}
          <div className={styles.responseList}>
            {!requests.length ? <div className={styles.emptyInbox}><RadioTower /><strong>근거리 병원을 조회하고 있습니다</strong><span>요청 대상이 확인되는 즉시 이 화면에 표시됩니다.</span></div> : null}
            {requests.map((request) => {
              const hospital = store.hospitals.find((item) => item.id === request.hospitalId);
              return <article key={request.id} data-status={request.status}>
                <div><span>{request.etaMinutes}분 · {request.distanceKm.toFixed(1)}km</span><h3>{hospital?.name ?? request.hospitalName ?? request.hospitalId}</h3>{hospital?.address || request.hospitalAddress ? <p><MapPin /> {hospital?.address ?? request.hospitalAddress}</p> : null}</div>
                <b>{request.status === "ACCEPTED" ? <><CheckCircle2 /> 수용 가능</> : request.status === "DECLINED" ? <><X /> 수용 곤란</> : request.status === "VIEWED" ? <><CircleDot /> 열람</> : <><Clock3 /> 요청 중</>}</b>
                {request.status === "ACCEPTED" ? <button type="button" disabled={pending} onClick={() => void selectDestination(request)}>이 병원 선택 <ChevronRight /></button> : null}
              </article>;
            })}
          </div>
        </div>
        <div className={`${styles.stickyAction} ${styles.matchingActions}`}>
          <button type="button" disabled={pending || expansionQueued || Boolean(accepted.length) || !nextRadius} onClick={() => void requestRangeExpansion()}><ScanSearch /> 요청 범위 확대</button>
          <button type="button" disabled={pending} onClick={() => void refresh()}><RefreshCw /> 병원 요청 갱신</button>
        </div>
      </div>
    );
  };

  const renderRoute = () => {
    if (!incident || !destinationRequest) return null;
    const directionsUrl = destinationLocation
      ? buildKakaoDirectionsLink(
        { ...incident.scene, name: "환자 현장" },
        { ...destinationLocation, name: destinationName },
      )
      : null;
    return (
      <div className={styles.mobilePageAction}>
        {pageBar(incident.stage === "transporting" ? "병원 이동" : "이송지 확인", () => incident.stage === "destination-selected" ? undefined : goHome())}
        <div className={styles.mobileScroll}>
          <section className={styles.selectedBanner}><CheckCircle2 /><div><small>수용 병원 연결</small><h2>{destinationName}</h2></div></section>
          {destinationLocation ? <div className={styles.routeMap}><KakaoRouteMap origin={incident.scene} destination={destinationLocation} originName="환자 현장" destinationName={destinationName} /></div> : null}
          <section className={styles.routeSummary}><span><Route /><small>예상 이동</small><strong>{destinationRequest.etaMinutes}분</strong></span><span><Navigation /><small>도로 거리</small><strong>{destinationRequest.distanceKm.toFixed(1)}km</strong></span>{destinationAddress ? <p><MapPin /> {destinationAddress}</p> : null}</section>
        </div>
        <div className={styles.stickyAction}>
          {incident.stage === "destination-selected" && directionsUrl ? <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={pending}
            onClick={(event) => {
              if (pending) {
                event.preventDefault();
                return;
              }
              void doRun(() => api.startTransport(incident.id));
            }}
          ><Navigation /> 병원으로 출발</a> : null}
          {incident.stage === "transporting" ? <button disabled={pending} onClick={() => void doRun(() => api.arriveHospital(incident.id))}><HospitalIcon /> 병원 도착</button> : null}
        </div>
      </div>
    );
  };

  const renderArrived = () => incident && destinationRequest ? (
    <div className={styles.mobilePage}>
      {pageBar("이송 완료")}
      <section className={styles.arrival}><Check /><small>병원 도착 기록</small><h1>{destinationName}</h1><p>{incident.code}</p><time>{formatTime(incident.timeline.hospitalArrivedAt)}</time><button type="button" onClick={goHome}>출동 목록으로</button></section>
    </div>
  ) : null;

  const showMatching = incident?.stage === "matching"
    || (incident?.stage === "card-confirmed" && matchingRequestedId === incident.id);

  const content = !incident ? renderCaseList()
    : assessmentOpen || incident.stage === "assessing" ? renderAssessment()
      : ["assigned", "enroute", "scene-arrived"].includes(incident.stage) ? renderDispatch()
        : incident.stage === "patient-contact" ? renderAssessment()
          : showMatching ? renderMatching()
            : incident.stage === "card-confirmed" ? renderCard()
              : ["destination-selected", "transporting"].includes(incident.stage) ? renderRoute()
                : renderArrived();

  return (
    <main className={styles.mobileShell}>
      <div className={styles.mobileApp}>
        <Brand mobile subtitle={incident?.code ?? "구급대원"} onHome={goHome} onDemoReset={() => void resetDemo()} resetPending={pending} />
        {error ? <div className={styles.globalError} role="alert"><AlertTriangle /> {error}</div> : null}
        {acceptanceAlert ? <div className={styles.acceptanceToast} role="status" aria-live="assertive"><CheckCircle2 /><span><strong>수용 가능 회신</strong>{acceptanceAlert}</span></div> : null}
        {content}
      </div>
    </main>
  );
}
