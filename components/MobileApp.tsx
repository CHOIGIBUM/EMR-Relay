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
import { SCENARIO, STAGE_LABEL, stageAtLeast, useDemo, type CpssValues, type VitalValues } from "./DemoContext";
import styles from "./MobileApp.module.css";

type Tab = "field" | "patient" | "hospital" | "handoff";
type VoiceMode = "listening" | "review" | null;

function defaultTab(stage: ReturnType<typeof useDemo>["state"]["stage"]): Tab {
  if (["coordination-requested", "hospital-requested", "info-requested", "info-sent", "declined", "accepted", "destination-confirmed"].includes(stage)) return "hospital";
  if (["hospital-arrived", "handoff-sent", "complete"].includes(stage)) return "handoff";
  if (stage === "summary-ready") return "patient";
  return "field";
}

const transcriptSteps = [
  "78세 여성, 의식은 명료하고…",
  "78세 여성, 의식은 명료하고 오른쪽 얼굴 처짐과 오른팔 위약이 있습니다.",
  "78세 여성, 의식은 명료하고 오른쪽 얼굴 처짐과 오른팔 위약이 있습니다. 말이 어눌합니다.",
  "마지막 정상 확인 13시 40분, 이웃이 14시 15분에 처음 이상 상태를 발견했습니다.",
];

const vitalFields: Array<{ key: keyof VitalValues; label: string; unit: string; placeholder: string }> = [
  { key: "bp", label: "혈압 BP", unit: "mmHg", placeholder: "예: 178/96" },
  { key: "pr", label: "맥박 PR", unit: "회/분", placeholder: "예: 92" },
  { key: "rr", label: "호흡수 RR", unit: "회/분", placeholder: "예: 18" },
  { key: "spo2", label: "SpO₂", unit: "%", placeholder: "예: 97" },
  { key: "temp", label: "체온 BT", unit: "℃", placeholder: "예: 36.7" },
  { key: "glucose", label: "혈당 BST", unit: "mg/dL", placeholder: "예: 118" },
];

const cpssOptions: Record<keyof CpssValues, string[]> = {
  face: ["정상", "좌측", "우측", "평가 불가"],
  arm: ["정상", "좌측", "우측", "평가 불가"],
  speech: ["정상", "어눌함", "표현 곤란", "평가 불가"],
};

const cpssLabels: Record<keyof CpssValues, { title: string; hint: string }> = {
  face: { title: "얼굴 처짐", hint: "이를 보이게 하고 좌우를 확인" },
  arm: { title: "팔 위약", hint: "양팔을 들어 10초간 유지" },
  speech: { title: "말하기", hint: "문장 반복과 발음 확인" },
};

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
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<number | null>(null);

  const notify = (message: string) => {
    setToast(message);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => () => {
    if (toastRef.current) window.clearTimeout(toastRef.current);
  }, []);

  useEffect(() => {
    if (voiceMode !== "listening") return;
    const timer = window.setInterval(() => {
      setTranscriptIndex((current) => Math.min(current + 1, transcriptSteps.length - 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [voiceMode]);

  const assessmentReady = useMemo(
    () => state.vitalsConfirmed && state.avpu !== "미확인" && state.voiceConfirmed && Object.values(state.cpss).every((value) => value !== "미확인"),
    [state.vitalsConfirmed, state.avpu, state.voiceConfirmed, state.cpss],
  );

  const beginVoice = () => {
    setTranscriptIndex(0);
    setVoiceMode("listening");
  };

  const finishVoice = () => {
    if (voiceMode === "listening") setVoiceMode("review");
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
    if ((event.key === " " || event.key === "Enter") && voiceMode === null) {
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
        <strong>14:32</strong>
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
            <time><Clock3 size={14} /> 지령 {SCENARIO.dispatchTime}</time>
          </div>
          <strong>의식·운동 이상</strong>
          <p>{SCENARIO.reportedPatient} · {SCENARIO.reportedComplaint}</p>
          <div className={styles.caseLocation}><MapPin size={15} /> {SCENARIO.locationShort}</div>
          <div className={styles.caseFooter}><StatusBadge tone="amber">출동 배정</StatusBadge><span>홍천소방서 구급1대</span><ChevronRight size={19} /></div>
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
              <div><dt>신고시각</dt><dd>{SCENARIO.reportTime}</dd></div>
              <div><dt>의식·호흡</dt><dd>의식 있음 · 호흡함</dd></div>
              <div><dt>발견시각</dt><dd>14:15 추정</dd></div>
            </dl>
          </section>

          <section className={styles.routeCard}>
            <div className={styles.mapMini}>
              <span className={styles.mapOrigin}><Ambulance size={16} /></span>
              <i />
              <span className={styles.mapDestination}><MapPin size={16} /></span>
            </div>
            <div><span>현장까지</span><strong>{enroute ? "5분" : "6분"}</strong><small>3.8 km · 북방면 방면</small></div>
            <Navigation size={20} />
          </section>

          <section className={styles.locationCard}>
            <div><MapPin size={18} /><strong>{SCENARIO.location}</strong></div>
            <p>{SCENARIO.access}</p>
            <button onClick={() => notify("신고자에게 전화를 연결합니다.")}><Phone size={16} /> 신고자 전화</button>
          </section>

          <div className={styles.timeStrip}>
            <div data-state="done"><span><Check size={13} /></span><strong>신고 접수</strong><time>14:20</time></div>
            <i />
            <div data-state={enroute ? "done" : "current"}><span>{enroute ? <Check size={13} /> : "2"}</span><strong>출동 시작</strong><time>{enroute ? "14:22" : "확인 전"}</time></div>
            <i />
            <div data-state={enroute ? "current" : "waiting"}><span>3</span><strong>현장 도착</strong><time>도착 후 확인</time></div>
          </div>
        </main>
        <div className={styles.stickyAction}>
          {!enroute ? (
            <button className={styles.primaryAction} onClick={() => transition("enroute", "14:22", "구급대원", "출동 시작", "홍천소방서 구급1대 · 시각 자동 기록", "teal")}>
              <Ambulance size={21} /> 출동 시작
            </button>
          ) : (
            <button className={styles.primaryAction} onClick={() => transition("scene-arrived", "14:27", "구급대원", "현장 도착", `${SCENARIO.location} · GPS 확인`, "teal")}>
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
          <p>14:27 · {SCENARIO.location}</p>
        </section>
        <section className={styles.arrivalChecklist}>
          <div><ShieldCheck size={18} /><span><strong>현장 안전 확인</strong><small>특이 위험요소 신고 없음</small></span><StatusBadge tone="teal">확인</StatusBadge></div>
          <div><MapPin size={18} /><span><strong>환자 위치</strong><small>{SCENARIO.access}</small></span></div>
          <div><UserRound size={18} /><span><strong>정보 제공자</strong><small>{SCENARIO.caller} 현장 대기</small></span></div>
        </section>
        <div className={styles.noticeBox}><Info size={18} /><span><strong>현장 도착과 환자 접촉은 다릅니다.</strong><small>환자를 실제로 확인한 뒤 접촉 버튼을 눌러주세요.</small></span></div>
      </main>
      <div className={styles.stickyAction}>
        <button className={styles.primaryAction} onClick={() => transition("patient-contact", "14:28", "구급대원", "환자 접촉", "78세 여성 · 현장 직접 확인", "teal")}>
          <UserRound size={21} /> 환자 접촉
        </button>
        <span>환자를 실제로 확인한 시각이 기록됩니다.</span>
      </div>
    </>
  );

  const setCpss = (key: keyof CpssValues, value: string) => {
    dispatch({ type: "SET_CPSS", key, value: value as CpssValues[keyof CpssValues] });
  };

  const renderFieldAssessment = () => (
    <>
      <section className={styles.patientIdentity}>
        <div><span>현장에서 확인한 환자</span><h1>{SCENARIO.patient}</h1><p>{SCENARIO.living}</p></div>
        <SourceTag tone="confirmed">구급대 확인</SourceTag>
      </section>

      <div className={styles.warningBox}><AlertTriangle size={18} /><span><strong>신고 내용은 진단 결과가 아닙니다.</strong><small>환자 상태를 직접 평가하고 확인한 값만 공유합니다.</small></span></div>

      <section className={styles.formSection}>
        <div className={styles.sectionTitle}><div><HeartPulse size={18} /><strong>최초 활력징후</strong></div><span>측정시각 {state.vitalsConfirmed ? "14:29" : "미기록"}</span></div>
        {!state.vitalsConfirmed && (
          <button className={styles.measureButton} onClick={() => dispatch({ type: "LOAD_VITALS" })}>
            <Activity size={18} /><span><strong>측정값 입력</strong><small>시연 환자의 측정값을 불러와 수정할 수 있습니다.</small></span><ArrowRight size={17} />
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
        <div className={styles.sectionTitle}><div><Activity size={18} /><strong>병원 전 뇌졸중 선별검사(CPSS)</strong></div><SourceTag tone={state.strokeConfirmed ? "confirmed" : "neutral"}>{state.strokeConfirmed ? "확인됨" : "확인 중"}</SourceTag></div>
        {Object.keys(cpssLabels).map((rawKey) => {
          const key = rawKey as keyof CpssValues;
          return (
            <div className={styles.cpssRow} key={key}>
              <div><strong>{cpssLabels[key].title}</strong><small>{cpssLabels[key].hint}</small></div>
              <div>{cpssOptions[key].map((value) => <button className={state.cpss[key] === value ? styles.choiceActive : ""} onClick={() => setCpss(key, value)} key={value}>{value}</button>)}</div>
            </div>
          );
        })}
      </section>

      <section className={styles.timeSection}>
        <div><span><Clock3 size={17} /> 마지막 정상 확인 LNT</span><strong>{state.voiceConfirmed ? SCENARIO.lnt : "확인 필요"}</strong><small>{state.voiceConfirmed ? SCENARIO.lntSource : "정보 제공자와 시각을 확인하세요"}</small></div>
        <div><span><Clock3 size={17} /> 최초 이상 발견 FAT</span><strong>{state.voiceConfirmed ? SCENARIO.fat : "확인 필요"}</strong><small>{state.voiceConfirmed ? SCENARIO.fatSource : "발견자와 시각을 확인하세요"}</small></div>
      </section>

      <button
        className={styles.pttButton}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={finishVoice}
        onKeyDown={handleVoiceKeyDown}
        onKeyUp={handleVoiceKeyUp}
      >
        <span><Mic size={24} /></span>
        <div><strong>누르고 말하기</strong><small>환자 상태를 말하고 손을 떼세요</small></div>
      </button>

      <button
        className={styles.fullAction}
        disabled={!assessmentReady}
        onClick={() => { dispatch({ type: "CONFIRM_ASSESSMENT" }); setTab("patient"); }}
      >
        <ClipboardCheck size={19} /> 환자 확인본 만들기
      </button>
      {!assessmentReady && <p className={styles.requirement}>활력징후·AVPU·CPSS와 LNT/FAT를 확인하면 다음 단계로 진행할 수 있습니다.</p>}
    </>
  );

  const renderPatientSummary = () => (
    <>
      <section className={styles.summaryHero}>
        <div className={styles.cardEyebrow}><UserRound size={15} /> 현재 환자 상태 <SourceTag tone={stageAtLeast(state.stage, "summary-ready") ? "confirmed" : "neutral"}>{stageAtLeast(state.stage, "summary-ready") ? "구급대원 확인본" : "작성 중"}</SourceTag></div>
        <h1>{SCENARIO.patient}</h1>
        <p>{SCENARIO.chiefComplaint}</p>
        <div className={styles.summaryFlags}><span>급성 뇌졸중 의심</span><span>CPSS 양성</span><span>Pre-KTAS {SCENARIO.preKtas}</span></div>
      </section>

      <section className={styles.compactVitals}>
        <div><span>BP</span><strong>{state.vitals.bp || "—"}</strong><small>mmHg</small></div>
        <div><span>PR</span><strong>{state.vitals.pr || "—"}</strong><small>회/분</small></div>
        <div><span>RR</span><strong>{state.vitals.rr || "—"}</strong><small>회/분</small></div>
        <div><span>SpO₂</span><strong>{state.vitals.spo2 || "—"}</strong><small>%</small></div>
        <div><span>BST</span><strong>{state.vitals.glucose || "—"}</strong><small>mg/dL</small></div>
        <div><span>AVPU</span><strong>{state.avpu}</strong><small>14:29</small></div>
      </section>

      <section className={styles.detailList}>
        <div><span>LNT</span><strong>{SCENARIO.lnt}</strong><small>{SCENARIO.lntSource} · 자녀 진술</small></div>
        <div><span>FAT</span><strong>{SCENARIO.fat}</strong><small>{SCENARIO.fatSource} · 이웃 진술</small></div>
        <div><span>CPSS</span><strong>얼굴 우측 · 팔 우측 · 말 어눌함</strong><small>구급대원 직접 확인</small></div>
        <div><span>병력</span><strong>{SCENARIO.history.join(" · ")}</strong><small>환자·약 봉투 확인</small></div>
        <div data-tone="unknown"><span>복용약</span><strong>{SCENARIO.medication}</strong><small>빈칸이 아니라 미상으로 전달</small></div>
        <div data-tone="unknown"><span>알레르기</span><strong>{SCENARIO.allergy}</strong><small>확인 가능한 정보 없음</small></div>
      </section>

      {state.stage === "summary-ready" && (
        <button className={styles.fullAction} onClick={() => { dispatch({ type: "REQUEST_COORDINATION" }); setTab("hospital"); }}>
          <RadioTower size={19} /> 상황실에 병원 조정 요청
        </button>
      )}
    </>
  );

  const renderHospitalStatus = () => {
    const status = (() => {
      if (state.stage === "coordination-requested") return { icon: RadioTower, title: "상황실이 요청을 확인하고 있습니다", detail: "환자 확인본은 읽기 전용으로 공유되었습니다.", tone: "amber" as const };
      if (state.stage === "hospital-requested") return { icon: Hospital, title: `${selectedHospital?.name ?? "병원"} 회신 대기`, detail: "한 번에 한 병원에만 활성 요청을 전송했습니다.", tone: "amber" as const };
      if (state.stage === "info-requested") return { icon: FileText, title: "병원이 추가정보를 요청했습니다", detail: state.requestedInfo.join(" · "), tone: "amber" as const };
      if (state.stage === "info-sent") return { icon: Send, title: "추가정보를 전달했습니다", detail: state.infoReply ?? "미상 항목 회신", tone: "teal" as const };
      if (state.stage === "declined") return { icon: RefreshCw, title: "상황실이 다음 병원을 확인 중입니다", detail: "이전 요청과 수용 곤란 사유는 기록에 남습니다.", tone: "red" as const };
      if (state.stage === "accepted") return { icon: CheckCircle2, title: "병원에서 수용 가능으로 회신했습니다", detail: "구급대원이 이송지를 확인해야 출발할 수 있습니다.", tone: "green" as const };
      if (state.stage === "destination-confirmed") return { icon: Route, title: "이송지를 확인했습니다", detail: "현장 출발 버튼을 누르면 출발시각이 기록됩니다.", tone: "teal" as const };
      return { icon: RadioTower, title: "병원 조정 요청 전", detail: "환자 확인본을 만든 뒤 상황실로 요청합니다.", tone: "slate" as const };
    })();
    const Icon = status.icon;

    return (
      <>
        <section className={styles.statusHero} data-tone={status.tone}>
          <span><Icon size={26} /></span><div><small>현재 진행</small><h1>{status.title}</h1><p>{status.detail}</p></div>
        </section>

        {selectedHospital && (
          <section className={styles.destinationCard}>
            <div className={styles.sectionTitle}><div><Hospital size={18} /><strong>확인 요청 병원</strong></div><StatusBadge tone={state.stage === "accepted" || state.stage === "destination-confirmed" ? "green" : "amber"}>{state.stage === "accepted" || state.stage === "destination-confirmed" ? "수용 가능" : "확인 중"}</StatusBadge></div>
            <h2>{selectedHospital.name}</h2>
            <p>{selectedHospital.location}</p>
            <div><span><Route size={15} /> {selectedHospital.distance}</span><span><Clock3 size={15} /> 예상 {selectedHospital.eta}</span></div>
          </section>
        )}

        {state.stage === "info-requested" && (
          <section className={styles.infoRequestCard}>
            <span>병원 요청 항목</span>
            <strong>{state.requestedInfo.join(" · ")}</strong>
            <p>약 봉투와 환자·이웃 진술로 확인했으나 복용 여부와 마지막 복용시각을 확인할 수 없습니다.</p>
            <button onClick={() => dispatch({ type: "ANSWER_INFO" })}><Send size={18} /> 미상으로 회신</button>
          </section>
        )}

        {state.stage === "accepted" && (
          <button className={styles.fullAction} onClick={() => dispatch({ type: "CONFIRM_DESTINATION" })}>
            <CheckCircle2 size={19} /> 이송지 확인
          </button>
        )}

        {state.stage === "destination-confirmed" && (
          <button className={styles.fullAction} onClick={() => { transition("transporting", "14:40", "구급대원", "이송 시작", `${selectedHospital?.name} · ETA ${selectedHospital?.eta}`, "teal"); setTab("field"); }}>
            <Ambulance size={19} /> 이송 시작
          </button>
        )}

        <section className={styles.mobileTimeline}>
          <div className={styles.sectionTitle}><div><Clock3 size={18} /><strong>요청 진행 기록</strong></div></div>
          {[...state.events].reverse().filter((event) => ["병원", "이송조정 상황실", "구급대원"].includes(event.actor)).slice(0, 6).map((event) => (
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
        <div className={styles.etaPanel}><span>예상 도착</span><strong>{selectedHospital?.eta ?? "35분"}</strong><small>{selectedHospital?.name}</small></div>
      </section>
      <section className={styles.transportStatus}>
        <div><span>이송 시작</span><strong>14:40</strong></div>
        <div><span>최근 갱신</span><strong>{state.reassessmentSaved ? "14:52" : "14:40"}</strong></div>
        <div><span>상태 공유</span><strong>{state.reassessmentSaved ? "병원 전달됨" : "최초 상태"}</strong></div>
      </section>
      <section className={styles.recheckCard}>
        <div className={styles.sectionTitle}><div><Activity size={18} /><strong>이송 중 재평가</strong></div><StatusBadge tone={state.reassessmentSaved ? "green" : "slate"}>{state.reassessmentSaved ? "저장됨" : "미기록"}</StatusBadge></div>
        <div className={styles.recheckValues}><span>AVPU <b>A</b></span><span>BP <b>180/98</b> mmHg</span><span>SpO₂ <b>97%</b></span><span>증상 <b>지속</b></span></div>
        {!state.reassessmentSaved && <button onClick={() => dispatch({ type: "SAVE_REASSESSMENT" })}><RefreshCw size={17} /> 재평가 기록</button>}
      </section>
      <button className={styles.fullAction} onClick={() => { transition("hospital-arrived", "15:03", "구급대원", "병원 도착", `${selectedHospital?.name} · GPS 및 사용자 확인`, "teal"); setTab("handoff"); }}>
        <Hospital size={19} /> 병원 도착
      </button>
    </>
  );

  const renderHandoff = () => (
    <>
      <section className={styles.handoffHero} data-complete={state.stage === "complete"}>
        <span>{state.stage === "complete" ? <CheckCircle2 size={30} /> : <ClipboardCheck size={30} />}</span>
        <div><small>{state.stage === "complete" ? "환자 인수 완료" : state.stage === "handoff-sent" ? "병원 인수 확인 대기" : "병원 도착 15:03"}</small><h1>{state.stage === "complete" ? "인계가 완료되었습니다" : "최종 인계 내용을 확인하세요"}</h1><p>{selectedHospital?.name}</p></div>
      </section>
      <section className={styles.handoffCard}>
        <div className={styles.sectionTitle}><div><FileText size={18} /><strong>구두·전자 인계 카드</strong></div><SourceTag tone="confirmed">최종 확인본</SourceTag></div>
        <dl>
          <div><dt>환자</dt><dd>{SCENARIO.patient} · {SCENARIO.living}</dd></div>
          <div><dt>주증상</dt><dd>{SCENARIO.chiefComplaint}</dd></div>
          <div><dt>LNT / FAT</dt><dd>{SCENARIO.lnt} / {SCENARIO.fat}</dd></div>
          <div><dt>CPSS</dt><dd>얼굴 우측 · 팔 우측 · 말 어눌함</dd></div>
          <div><dt>최초 활력</dt><dd>BP {state.vitals.bp} · PR {state.vitals.pr} · SpO₂ {state.vitals.spo2}%</dd></div>
          <div><dt>재평가</dt><dd>{state.reassessmentSaved ? "AVPU A · BP 180/98 · 증상 지속" : "추가 기록 없음"}</dd></div>
          <div><dt>미상 항목</dt><dd>항응고제 · 알레르기</dd></div>
        </dl>
      </section>
      {state.stage === "hospital-arrived" && (
        <button className={styles.fullAction} onClick={() => dispatch({ type: "SET_HANDOFF", receiver: "", role: "간호사" })}>
          <Send size={19} /> 구두·전자 인계 완료
        </button>
      )}
      {state.stage === "handoff-sent" && <div className={styles.waitingBox}><span className={styles.pulseDot} /><div><strong>병원 인수 확인을 기다리고 있습니다</strong><small>병원 담당자가 인수해야 사건이 종료됩니다.</small></div></div>}
      {state.stage === "complete" && (
        <section className={styles.completeDetails}>
          <div><span>인수자</span><strong>{state.handoffRole} {state.handoffReceiver}</strong></div>
          <div><span>인수시각</span><strong>15:06</strong></div>
          <div><span>사건상태</span><strong>환자 인수 완료</strong></div>
        </section>
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

        {voiceMode && (
          <div className={styles.voiceOverlay} role="dialog" aria-modal="true" aria-label="음성으로 환자 상태 기록">
            <button className={styles.voiceClose} aria-label="음성 입력 닫기" onClick={() => setVoiceMode(null)}><X size={19} /></button>
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
            ) : (
              <div className={styles.voiceReview}>
                <span className={styles.reviewIcon}><ClipboardCheck size={25} /></span>
                <h2>말한 내용을 확인하세요</h2>
                <p>확인하기 전에는 환자 기록이나 병원에 전달되지 않습니다.</p>
                <div className={styles.transcriptBox}>“78세 여성, 의식 명료. 오른쪽 얼굴과 팔에 위약이 있고 말이 어눌합니다. LNT 13시 40분, FAT 14시 15분입니다.”</div>
                <div className={styles.extractedList}>
                  <div><span>AVPU</span><strong>A</strong><SourceTag>확인 대기</SourceTag></div>
                  <div><span>얼굴 처짐</span><strong>우측</strong><SourceTag>확인 대기</SourceTag></div>
                  <div><span>팔 위약</span><strong>우측</strong><SourceTag>확인 대기</SourceTag></div>
                  <div><span>말하기</span><strong>어눌함</strong><SourceTag>확인 대기</SourceTag></div>
                  <div><span>LNT / FAT</span><strong>13:40 / 14:15</strong><SourceTag>확인 대기</SourceTag></div>
                </div>
                <div className={styles.reviewActions}>
                  <button onClick={() => setVoiceMode(null)}>취소</button>
                  <button onClick={() => { dispatch({ type: "CONFIRM_VOICE" }); setVoiceMode(null); notify("구급대원 확인값으로 반영했습니다."); }}><Check size={18} /> 현장 기록에 반영</button>
                </div>
              </div>
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
          <div><strong>{SCENARIO.patient}</strong><small>{SCENARIO.chiefComplaint}</small></div>
        </div>
        <div className={styles.guideEvents}>
          {[...state.events].reverse().slice(0, 4).map((event) => (
            <div key={event.id}><time>{event.time}</time><span><strong>{event.title}</strong><small>{event.actor}</small></span></div>
          ))}
        </div>
        <div className={styles.guideRule}><ShieldCheck size={17} /><span><strong>자동 판정하지 않습니다</strong><small>AI는 정리 후보를 만들고 구급대원이 확인합니다.</small></span></div>
      </aside>
    </div>
  );
}
