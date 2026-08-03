"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  Ambulance,
  ArrowRight,
  Check,
  Clock3,
  FileText,
  Hospital,
  MapPin,
  RadioTower,
  RefreshCcw,
  Route,
  ShieldCheck,
} from "lucide-react";
import { DemoProvider, FLOW_STAGES, STAGE_LABEL, useDemo, type Actor, type DemoEvent, type DemoStage } from "./DemoContext";
import MobileApp from "./MobileApp";
import ControlConsole from "./ControlConsole";
import HospitalConsole from "./HospitalConsole";
import ReportConsole from "./ReportConsole";
import { EMS_API_CONFIG } from "@/lib/emsApi";
import styles from "./EMSRelayApp.module.css";

type View = "mobile" | "control" | "hospital" | "report" | "workflow";

type RoleMeta = {
  label: string;
  short: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const roles: Record<View, RoleMeta> = {
  mobile: {
    label: "구급대원 모바일",
    short: "구급대",
    description: "환자 확인부터 이송·인계까지 담당합니다.",
    icon: Ambulance,
  },
  control: {
    label: "이송조정 상황실",
    short: "상황실",
    description: "진행을 감시하고 지연·반복 거절 시 연락을 지원합니다.",
    icon: RadioTower,
  },
  hospital: {
    label: "병원 수용 웹",
    short: "병원",
    description: "수용 회신과 환자 인수를 확인합니다.",
    icon: Hospital,
  },
  report: {
    label: "구급활동 기록",
    short: "보고서",
    description: "인계 완료 후 자동 작성된 기록을 검토합니다.",
    icon: FileText,
  },
  workflow: {
    label: "전체 시연 흐름",
    short: "전체 흐름",
    description: "한 사건이 세 사용자에게 이어지는 과정을 봅니다.",
    icon: Route,
  },
};

const stageActor: Record<DemoStage, Actor> = {
  assigned: "119 상황실",
  enroute: "구급대원",
  "scene-arrived": "구급대원",
  "patient-contact": "구급대원",
  assessing: "구급대원",
  "summary-ready": "구급대원",
  "coordination-requested": "이송조정 상황실",
  "hospital-requested": "구급대원",
  "info-requested": "병원",
  "info-sent": "구급대원",
  declined: "병원",
  accepted: "병원",
  "destination-confirmed": "구급대원",
  transporting: "구급대원",
  "hospital-arrived": "구급대원",
  "handoff-sent": "구급대원",
  complete: "병원",
};

const stageEventTitle: Record<DemoStage, string> = {
  assigned: "구급대 출동 지령",
  enroute: "출동 시작",
  "scene-arrived": "현장 도착",
  "patient-contact": "환자 접촉",
  assessing: "최초 활력징후 확인",
  "summary-ready": "환자 확인본 생성",
  "coordination-requested": "상황실 지원 요청",
  "hospital-requested": "병원 수용 문의",
  "info-requested": "추가정보 요청",
  "info-sent": "추가정보 회신",
  declined: "수용 곤란 회신",
  accepted: "수용 가능 회신",
  "destination-confirmed": "이송지 확인",
  transporting: "이송 시작",
  "hospital-arrived": "병원 도착",
  "handoff-sent": "구두·전자 인계 완료",
  complete: "환자 인수 확인",
};

function stageTime(stage: DemoStage, events: DemoEvent[]) {
  const title = stageEventTitle[stage];
  return [...events].reverse().find((event) => event.title === title)?.time ?? "—";
}

function noticeCount(view: View, stage: DemoStage) {
  if (view === "control" && (stage === "coordination-requested" || stage === "hospital-requested" || stage === "declined")) return 1;
  if (view === "hospital" && (stage === "hospital-requested" || stage === "info-sent" || stage === "handoff-sent")) return 1;
  if (view === "mobile" && (stage === "info-requested" || stage === "accepted" || stage === "complete")) return 1;
  if (view === "report" && stage === "complete") return 1;
  return 0;
}

function WorkflowBoard({ onOpenRole }: { onOpenRole: (view: View) => void }) {
  const { state, progress, reset, selectedHospital, scenario: SCENARIO } = useDemo();

  return (
    <section className={styles.workflowBoard}>
      <div className={styles.workflowHero}>
        <div>
          <span className={styles.kicker}>단일 시연 사건 · {SCENARIO.id}</span>
          <h2>{SCENARIO.patient} · {SCENARIO.impression}</h2>
          <p>
            신고정보를 현장에서 확인하고 PTT 변경안을 검토한 뒤, 같은 확정 상태가 병원 문의·이송·인계·보고서 초안까지 이어집니다.
          </p>
        </div>
        <div className={styles.heroFacts}>
          <span><MapPin size={16} /> {SCENARIO.locationShort}</span>
          <span><Clock3 size={16} /> 신고 {state.events.find((event) => event.title === "119 신고 접수")?.time ?? "—"}</span>
          <span><Activity size={16} /> {STAGE_LABEL[state.stage]}</span>
        </div>
      </div>

      <div className={styles.progressHeader}>
        <div>
          <strong>사건 진행도</strong>
          <span>{Math.round((progress / (FLOW_STAGES.length - 1)) * 100)}%</span>
        </div>
        <button onClick={reset}><RefreshCcw size={16} /> 시연 초기화</button>
      </div>
      <div className={styles.progressTrack} aria-label={`사건 진행도 ${Math.round((progress / (FLOW_STAGES.length - 1)) * 100)}%`}>
        <span style={{ width: `${Math.round((progress / (FLOW_STAGES.length - 1)) * 100)}%` }} />
      </div>

      <div className={styles.roleLanes}>
        {(["mobile", "control", "hospital"] as const).map((role) => {
          const meta = roles[role];
          const Icon = meta.icon;
          const roleLabel: Actor = role === "mobile" ? "구급대원" : role === "control" ? "이송조정 상황실" : "병원";
          const items = FLOW_STAGES.filter((stage) => stageActor[stage] === roleLabel);
          return (
            <article className={styles.roleLane} key={role}>
              <button className={styles.laneHeader} onClick={() => onOpenRole(role)}>
                <span><Icon size={19} /></span>
                <div><strong>{meta.label}</strong><small>{meta.description}</small></div>
                <ArrowRight size={17} />
              </button>
              <div className={styles.laneSteps}>
                {items.map((stage) => {
                  const index = FLOW_STAGES.indexOf(stage);
                  const done = index < progress || state.stage === "complete";
                  const current = stage === state.stage;
                  return (
                    <div className={`${styles.laneStep} ${done ? styles.stepDone : ""} ${current ? styles.stepCurrent : ""}`} key={stage}>
                      <span className={styles.stepMarker}>{done ? <Check size={14} /> : index + 1}</span>
                      <div><time>{stageTime(stage, state.events)}</time><strong>{STAGE_LABEL[stage]}</strong></div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <div className={styles.workflowBottom}>
        <section className={styles.eventPanel}>
          <div className={styles.panelTitle}>
            <div><Clock3 size={18} /><strong>자동 기록 타임라인</strong></div>
            <span>{state.events.length}개 기록</span>
          </div>
          <div className={styles.eventList}>
            {[...state.events].reverse().map((event) => (
              <div className={styles.eventItem} data-tone={event.tone ?? "neutral"} key={event.id}>
                <time>{event.time}</time>
                <i />
                <div><strong>{event.title}</strong><span>{event.detail}</span><small>{event.actor}</small></div>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.summaryPanel}>
          <div className={styles.panelTitle}>
            <div><ShieldCheck size={18} /><strong>현재 공유 상태</strong></div>
          </div>
          <dl>
            <div><dt>환자 확인</dt><dd>{state.stage === "assigned" || state.stage === "enroute" ? "현장 미확인" : "구급대 확인 진행"}</dd></div>
            <div><dt>병원 요청</dt><dd>{state.selectedHospitalId ? selectedHospital?.name : "요청 전"}</dd></div>
            <div><dt>수용 회신</dt><dd>{state.stage === "accepted" || progress > FLOW_STAGES.indexOf("accepted") ? "수용 가능" : state.stage === "declined" ? "수용 곤란" : "회신 전"}</dd></div>
            <div><dt>이송 상태</dt><dd>{STAGE_LABEL[state.stage]}</dd></div>
            <div><dt>인수 확인</dt><dd>{state.stage === "complete" ? `${state.handoffRole} ${state.handoffReceiver}` : "대기"}</dd></div>
          </dl>
          <p>병원 API 정보는 후보 탐색에만 사용하고, 실제 수용 상태는 병원 담당자의 회신으로만 표시합니다.</p>
        </aside>
      </div>
    </section>
  );
}

function AppShell() {
  const { state, reset, scenario: SCENARIO } = useDemo();
  const [view, setView] = useState<View>("mobile");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search).get("view");
      if (next === "mobile" || next === "control" || next === "hospital" || next === "report" || next === "workflow") setView(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeView = (next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const meta = roles[view];
  const MetaIcon = meta.icon;

  return (
    <div className={styles.appShell}>
      <header className={styles.topbar}>
        <button className={styles.brand} onClick={() => changeView("mobile")} aria-label="EMS Relay 구급대 화면">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ems-relay-icon.png" width={42} height={42} alt="" />
          <span><strong>EMS Relay</strong><small>응급환자 정보 연결</small></span>
        </button>

        <nav className={styles.roleNav} aria-label="시연 역할 전환">
          {(Object.keys(roles) as View[]).map((role) => {
            const RoleIcon = roles[role].icon;
            const count = noticeCount(role, state.stage);
            return (
              <button className={view === role ? styles.navActive : ""} onClick={() => changeView(role)} key={role} aria-current={view === role ? "page" : undefined}>
                <RoleIcon size={17} />
                <span>{roles[role].short}</span>
                {count > 0 && <b>{count}</b>}
              </button>
            );
          })}
        </nav>

        <div className={styles.topActions}>
          <span className={styles.liveState}>
            <i /> {EMS_API_CONFIG.mode === "remote" ? "AWS API 연결" : "로컬 시연 연결"}
          </span>
          <button onClick={reset} aria-label="시연 초기화"><RefreshCcw size={17} /><span>초기화</span></button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.viewHeading}>
          <span className={styles.viewIcon}><MetaIcon size={21} /></span>
          <div><h1>{meta.label}</h1><p>{meta.description}</p></div>
          <div className={styles.caseState}>
            <small>{SCENARIO.id}</small>
            <strong>{STAGE_LABEL[state.stage]}</strong>
          </div>
        </section>

        {view === "mobile" && <MobileApp />}
        {view === "control" && <ControlConsole />}
        {view === "hospital" && <HospitalConsole />}
        {view === "report" && <ReportConsole />}
        {view === "workflow" && <WorkflowBoard onOpenRole={changeView} />}
      </main>
    </div>
  );
}

export default function EMSRelayApp() {
  return (
    <DemoProvider>
      <AppShell />
    </DemoProvider>
  );
}
