"use client";

import { useMemo, useState } from "react";
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
  UserRound,
  X,
} from "lucide-react";
import KakaoRouteMap from "./KakaoRouteMap";
import type { PatientAssessment, StrokeSide, SpeechFinding } from "@/lib/v2/types";
import { applyVoiceChangesToAssessment } from "@/lib/v2/voiceProposal";
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

function normalizeClockInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function isClockTime(value?: string) {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function assessmentStepComplete(draft: PatientAssessment, step: number) {
  if (step === 0) {
    return Boolean(draft.age && draft.sex && draft.airway && draft.breathing && draft.circulation && draft.avpu && draft.chiefComplaint?.trim());
  }
  if (step === 1) return Boolean(draft.face && draft.arm && draft.speech);
  return Boolean(
    draft.systolicBp
    && draft.diastolicBp
    && draft.pulse
    && draft.respiratoryRate
    && draft.spo2
    && draft.glucose
    && isClockTime(draft.lastKnownWell)
    && draft.lastKnownWellBasis?.trim()
    && isClockTime(draft.firstAbnormalTime)
    && isClockTime(draft.measuredAt),
  );
}

export default function ParamedicApp() {
  const { api, store, loading, pending, error, run, refresh } = useV2();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentStep, setAssessmentStep] = useState(0);
  const [assessmentMaxStep, setAssessmentMaxStep] = useState(0);
  const [draft, setDraft] = useState<PatientAssessment>({});
  const [validation, setValidation] = useState<string | null>(null);
  const [matchingRequestedId, setMatchingRequestedId] = useState<string | null>(null);
  const incident = store?.cases.find((item) => item.id === selectedId) ?? null;
  const requests = useMemo(() => store?.requests.filter((item) => item.caseId === selectedId) ?? [], [selectedId, store?.requests]);
  const accepted = requests.filter((request) => request.status === "ACCEPTED");
  const destinationRequest = requests.find((request) => request.id === incident?.destinationRequestId) ?? null;
  const destinationHospital = store?.hospitals.find((hospital) => hospital.id === destinationRequest?.hospitalId) ?? null;
  const destinationName = destinationHospital?.name ?? destinationRequest?.hospitalName ?? destinationRequest?.hospitalId ?? "선택 병원";

  const goHome = () => {
    setSelectedId(null);
    setAssessmentOpen(false);
    setAssessmentStep(0);
    setAssessmentMaxStep(0);
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

  const beginMatching = async () => {
    if (!incident) return;
    setMatchingRequestedId(incident.id);
    try {
      await run(() => api.startMatching(incident.id));
    } catch {
      setMatchingRequestedId((current) => current === incident.id ? null : current);
    }
  };

  const validateStep = (step = assessmentStep) => {
    if (!assessmentStepComplete(draft, step)) {
      setValidation("이 단계의 필수 항목을 모두 확인해 주세요.");
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
      setValidation("필수 항목이 비어 있습니다. 표시된 단계를 다시 확인해 주세요.");
      return;
    }
    await doRun(async () => {
      await api.saveAssessment(incident.id, draft);
      await api.confirmPatientCard(incident.id);
    });
    setAssessmentOpen(false);
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
          <button type="button" className={styles.caseCard} key={item.id} onClick={() => setSelectedId(item.id)}>
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
    return (
      <div className={styles.mobilePageAction}>
        {pageBar(enroute ? "현장 이동" : arrived ? "현장 도착" : "출동 준비")}
        <div className={styles.mobileScroll}>
          <section className={styles.dispatchBrief}>
            <small>119 신고 내용</small><h2>{incident.reportSummary}</h2><p>{incident.reportDetail}</p>
            <div><span><UserRound /> {incident.estimatedAge} · {incident.estimatedSex}</span><span>{incident.reporter}</span></div>
          </section>
          <section className={styles.locationCard}><MapPin /><div><small>현장</small><strong>{incident.sceneAddress}</strong><span>{incident.station} · {incident.dispatchUnit}</span></div><Navigation /></section>
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
          {incident.stage === "scene-arrived" ? <button disabled={pending} onClick={() => void doRun(() => api.contactPatient(incident.id))}><UserRound /> 환자 접촉</button> : null}
        </div>
      </div>
    );
  };

  const renderContact = () => incident ? (
    <div className={styles.mobilePageAction}>
      {pageBar("환자 접촉", () => setSelectedId(null))}
      <div className={styles.mobileScroll}><section className={styles.confirmedMoment}><CheckCircle2 /><small>환자 접촉 기록</small><h1>{formatTime(incident.timeline.patientContactAt)}</h1><p>이제 현장에서 직접 확인한 환자 상태를 입력합니다.</p></section></div>
      <div className={styles.stickyAction}><button onClick={beginAssessment}><Activity /> 환자 상태 입력</button></div>
    </div>
  ) : null;

  const renderAssessment = () => {
    if (!incident) return null;
    const update = <K extends keyof PatientAssessment>(field: K, value: PatientAssessment[K]) => setDraft((current) => ({ ...current, [field]: value }));
    return (
      <div className={styles.mobilePageAction}>
        {pageBar("환자 상태 입력", () => { setAssessmentOpen(false); setValidation(null); })}
        <nav className={styles.assessmentNav}>{["기본", "CPSS", "활력·시간"].map((label, index) => <button key={label} type="button" disabled={index > assessmentMaxStep} data-active={assessmentStep === index} onClick={() => { setAssessmentStep(index); setValidation(null); }}><i>{index + 1}</i>{label}</button>)}</nav>
        <div className={styles.mobileScroll}>
          {assessmentStep === 0 ? <section className={styles.formSection}>
            <h2>환자 기본 확인</h2>
            <WheelPicker label="나이" value={draft.age} min={1} max={110} unit="세" onChange={(value) => update("age", value)} />
            <Choice label="성별" value={draft.sex} items={[{ value: "female", label: "여성" }, { value: "male", label: "남성" }, { value: "unknown", label: "미상" }]} onChange={(value) => update("sex", value)} />
            <Choice label="기도" value={draft.airway} items={[{ value: "patent", label: "유지" }, { value: "at-risk", label: "위험" }, { value: "obstructed", label: "폐쇄" }]} onChange={(value) => update("airway", value)} />
            <Choice label="호흡" value={draft.breathing} items={[{ value: "adequate", label: "적절" }, { value: "labored", label: "곤란" }, { value: "inadequate", label: "부적절" }]} onChange={(value) => update("breathing", value)} />
            <Choice label="순환" value={draft.circulation} items={[{ value: "stable", label: "안정" }, { value: "poor-perfusion", label: "관류 저하" }, { value: "arrest", label: "심정지" }]} onChange={(value) => update("circulation", value)} />
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
              <WheelPicker label="수축기 혈압" value={draft.systolicBp} min={60} max={260} unit="mmHg" onChange={(value) => update("systolicBp", value)} />
              <WheelPicker label="이완기 혈압" value={draft.diastolicBp} min={30} max={160} unit="mmHg" onChange={(value) => update("diastolicBp", value)} />
              <WheelPicker label="맥박" value={draft.pulse} min={20} max={220} unit="회/분" onChange={(value) => update("pulse", value)} />
              <WheelPicker label="호흡수" value={draft.respiratoryRate} min={4} max={60} unit="회/분" onChange={(value) => update("respiratoryRate", value)} />
              <WheelPicker label="SpO₂" value={draft.spo2} min={50} max={100} unit="%" onChange={(value) => update("spo2", value)} />
              <WheelPicker label="혈당" value={draft.glucose} min={20} max={500} unit="mg/dL" onChange={(value) => update("glucose", value)} />
            </div>
            {draft.glucose !== undefined && draft.glucose < 60 ? <div className={styles.warning}><AlertTriangle /><span><strong>혈당 60 mg/dL 미만</strong>저혈당 처치 후 신경학적 상태를 다시 확인하세요.</span></div> : null}
            <div className={styles.timeInputs}>
              <label>마지막 정상 확인<input inputMode="numeric" maxLength={5} placeholder="HH:MM" value={draft.lastKnownWell ?? ""} onChange={(event) => update("lastKnownWell", normalizeClockInput(event.target.value))} /></label>
              <label>마지막 정상 확인 근거<input value={draft.lastKnownWellBasis ?? ""} onChange={(event) => update("lastKnownWellBasis", event.target.value)} placeholder="보호자 목격·통화 등" /></label>
              <label>최초 이상 발견<input inputMode="numeric" maxLength={5} placeholder="HH:MM" value={draft.firstAbnormalTime ?? ""} onChange={(event) => update("firstAbnormalTime", normalizeClockInput(event.target.value))} /></label>
              <label>활력 측정 시각<input inputMode="numeric" maxLength={5} placeholder="HH:MM" value={draft.measuredAt ?? ""} onChange={(event) => update("measuredAt", normalizeClockInput(event.target.value))} /></label>
            </div>
            <PttInput
              caseId={incident.id}
              value={draft.voiceNote ?? ""}
              onChange={(value) => update("voiceNote", value)}
              onApply={(changes) => setDraft((current) => applyVoiceChangesToAssessment(current, changes))}
            />
          </section> : null}
          {validation ? <p className={styles.formError} role="alert">{validation}</p> : null}
        </div>
        <div className={styles.stickyAction}><button disabled={pending} onClick={() => void nextAssessment()}>{assessmentStep < 2 ? <>다음 확인 <ChevronRight /></> : <>환자 카드 확정 <Check /></>}</button></div>
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
            markers={requests.flatMap((request) => {
              const hospital = store.hospitals.find((item) => item.id === request.hospitalId);
              return hospital ? [{ id: request.id, name: hospital.name, location: hospital.location, status: request.status }] : [];
            })}
          />
          {accepted.length ? <section className={styles.matchNotice}><CheckCircle2 /><div><small>수용 가능 회신 {accepted.length}곳</small><strong>최종 이송병원을 선택하세요</strong></div></section> : null}
          <div className={styles.responseList}>
            {!requests.length ? <div className={styles.emptyInbox}><RadioTower /><strong>근거리 병원을 조회하고 있습니다</strong><span>요청 대상이 확인되는 즉시 이 화면에 표시됩니다.</span></div> : null}
            {requests.map((request) => {
              const hospital = store.hospitals.find((item) => item.id === request.hospitalId);
              return <article key={request.id} data-status={request.status}>
                <div><span>{request.etaMinutes}분 · {request.distanceKm.toFixed(1)}km</span><h3>{hospital?.name ?? request.hospitalName ?? request.hospitalId}</h3>{hospital?.address ? <p><MapPin /> {hospital.address}</p> : null}</div>
                <b>{request.status === "ACCEPTED" ? <><CheckCircle2 /> 수용 가능</> : request.status === "DECLINED" ? <><X /> 수용 곤란</> : request.status === "VIEWED" ? <><CircleDot /> 열람</> : <><Clock3 /> 요청 중</>}</b>
                {request.status === "ACCEPTED" ? <button disabled={pending} onClick={() => void doRun(() => api.selectDestination(incident.id, request.id))}>이 병원 선택 <ChevronRight /></button> : null}
              </article>;
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderRoute = () => {
    if (!incident || !destinationRequest) return null;
    return (
      <div className={styles.mobilePageAction}>
        {pageBar(incident.stage === "transporting" ? "병원 이동" : "이송지 확인", () => incident.stage === "destination-selected" ? undefined : goHome())}
        <div className={styles.mobileScroll}>
          <section className={styles.selectedBanner}><CheckCircle2 /><div><small>수용 병원 연결</small><h2>{destinationName}</h2></div></section>
          {destinationHospital ? <div className={styles.routeMap}><KakaoRouteMap origin={incident.scene} destination={destinationHospital.location} originName="환자 현장" destinationName={destinationHospital.name} /></div> : null}
          <section className={styles.routeSummary}><span><Route /><small>예상 이동</small><strong>{destinationRequest.etaMinutes}분</strong></span><span><Navigation /><small>도로 거리</small><strong>{destinationRequest.distanceKm.toFixed(1)}km</strong></span>{destinationHospital?.address ? <p><MapPin /> {destinationHospital.address}</p> : null}</section>
        </div>
        <div className={styles.stickyAction}>
          {incident.stage === "destination-selected" ? <button disabled={pending} onClick={() => void doRun(() => api.startTransport(incident.id))}><Navigation /> 병원으로 출발</button> : null}
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

  const content = !incident ? renderCaseList()
    : assessmentOpen || incident.stage === "assessing" ? renderAssessment()
      : ["assigned", "enroute", "scene-arrived"].includes(incident.stage) ? renderDispatch()
        : incident.stage === "patient-contact" ? renderContact()
          : incident.stage === "card-confirmed" ? renderCard()
            : incident.stage === "matching" || matchingRequestedId === incident.id ? renderMatching()
              : ["destination-selected", "transporting"].includes(incident.stage) ? renderRoute()
                : renderArrived();

  return (
    <main className={styles.mobileShell}>
      <div className={styles.mobileApp}>
        <Brand mobile subtitle={incident?.code ?? "구급대원"} onHome={goHome} />
        {error ? <div className={styles.globalError} role="alert"><AlertTriangle /> {error}</div> : null}
        {content}
      </div>
    </main>
  );
}
