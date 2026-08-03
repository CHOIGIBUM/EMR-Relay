"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  HeartPulse,
  History,
  Hospital,
  Info,
  LockKeyhole,
  MapPin,
  Pill,
  Printer,
  Save,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { CARDIO_DEMO_REPORT_DRAFT, SCENARIO, useDemo, type DemoEvent, type DemoState } from "./DemoContext";
import styles from "./ReportConsole.module.css";

type ReportTab = "activity" | "cardio";
type ReviewFilter = "all" | "review" | "unknown";
type ReportStatus = "draft" | "reviewing" | "confirmed";
type ReviewKey = "impression" | "medication" | "hospital" | "receiver";

type ReportViewModel = {
  caseId: string;
  patient: string;
  location: string;
  chiefComplaint: string;
  hospitalName: string;
  receiver: string;
  receiverRole: string;
  vitals: Array<{ label: string; value: string; unit: string }>;
  events: DemoEvent[];
  latestTime: string;
};

const REVIEW_ITEMS: Array<{
  key: ReviewKey;
  title: string;
  value: string;
  helper: string;
}> = [
  {
    key: "impression",
    title: "현장 평가 소견",
    value: "급성 관상동맥증후군 의심",
    helper: "확정 진단이 아닌 구급대원 현장 평가 소견입니다.",
  },
  {
    key: "medication",
    title: "복용약 확인",
    value: "와파린 복용 진술 · 약제 확인 필요",
    helper: "진술 기반 정보이며 실제 약제 확인 결과를 기록해야 합니다.",
  },
  {
    key: "hospital",
    title: "병원 수용문의 기록",
    value: "1차 문의 추가정보 요청 · 2차 문의 수용 가능",
    helper: "문의 순서와 수용곤란·추가정보 사유를 확인하세요.",
  },
  {
    key: "receiver",
    title: "환자 인수자",
    value: "응급실 인수자 이름과 직종",
    helper: "인계받은 의료진이 맞는지 확인하세요.",
  },
];

const UNKNOWN_ITEMS = [
  { label: "약물 알레르기", value: "미상", source: "환자·보호자 확인 불가" },
  { label: "12유도 심전도 상세 소견", value: "미상", source: "시행은 확인됨 · 상세 소견 미확인" },
  { label: "의료지도", value: "기록 없음 · 확인 필요", source: "기록 부재를 미시행으로 판단하지 않음" },
];

function cleanText(value: unknown, fallback = "원문 확인 필요") {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || text.includes("?") || text.includes("�")) return fallback;
  return text;
}

function displayValue(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function eventPresentation(event: DemoEvent) {
  return {
    title: cleanText(event.title),
    detail: cleanText(event.detail),
    actor: cleanText(event.actor),
  };
}

function toReportViewModel(
  state: DemoState,
  selectedHospital: { name?: string } | null,
): ReportViewModel {
  const scenario = SCENARIO as Record<string, unknown>;
  const receiver = displayValue(state.handoffReceiver, "미입력");
  const receiverRole = cleanText(state.handoffRole, "직종 미입력");

  return {
    caseId: cleanText(scenario.id, "—"),
    patient: cleanText(scenario.patient, "미입력"),
    location: cleanText(scenario.location, "확인 필요"),
    chiefComplaint: cleanText(scenario.chiefComplaint, "미입력"),
    hospitalName: cleanText(selectedHospital?.name, "미확정"),
    receiver,
    receiverRole,
    vitals: [
      { label: "혈압", value: displayValue(state.vitals.bp), unit: "mmHg" },
      { label: "맥박", value: displayValue(state.vitals.pr), unit: "회/분" },
      { label: "호흡수", value: displayValue(state.vitals.rr), unit: "회/분" },
      { label: "SpO₂", value: displayValue(state.vitals.spo2), unit: "%" },
      { label: "체온", value: displayValue(state.vitals.temp), unit: "℃" },
      { label: "혈당", value: displayValue(state.vitals.glucose), unit: "mg/dL" },
    ],
    events: Array.isArray(state.events) ? state.events : [],
    latestTime: state.events.at(-1)?.time ?? "—",
  };
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "teal" | "amber" | "slate" | "green";
}) {
  return (
    <span className={styles.statusPill} data-tone={tone}>
      {children}
    </span>
  );
}

export default function ReportConsole() {
  const { state, selectedHospital, dispatch } = useDemo();
  const [activeTab, setActiveTab] = useState<ReportTab>("activity");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("draft");
  const [reviewed, setReviewed] = useState<Set<ReviewKey>>(new Set());
  const [unknownConfirmed, setUnknownConfirmed] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const report = useMemo(
    () => toReportViewModel(state, selectedHospital),
    [state, selectedHospital],
  );
  const isCaseComplete = state.stage === "complete";
  const reviewComplete = reviewed.size === REVIEW_ITEMS.length;
  const unknownComplete = unknownConfirmed.size === UNKNOWN_ITEMS.length;
  const autoCount = CARDIO_DEMO_REPORT_DRAFT.completion.autoFilledFields;
  const needsReviewCount = REVIEW_ITEMS.length - reviewed.size;
  const unknownCount = UNKNOWN_ITEMS.length - unknownConfirmed.size;

  useEffect(() => {
    if (state.stage === "complete" && state.reportStatus === "ready") dispatch({ type: "CREATE_REPORT" });
  }, [state.stage, state.reportStatus, dispatch]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const toggleReview = (key: ReviewKey) => {
    setReportStatus((current) => (current === "draft" ? "reviewing" : current));
    setReviewed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmUnknown = (index: number) => {
    setReportStatus((current) => (current === "draft" ? "reviewing" : current));
    setUnknownConfirmed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const confirmReport = () => {
    if (!isCaseComplete) {
      notify("병원 인수 확인 후 보고서를 확정할 수 있습니다.");
      return;
    }
    if (!reviewComplete) {
      notify(`확인 필요한 항목 ${needsReviewCount}건을 먼저 검토하세요.`);
      return;
    }
    if (!unknownComplete) {
      notify(`미상 항목 ${unknownCount}건의 기록 상태를 먼저 확인하세요.`);
      return;
    }
    setReportStatus("confirmed");
    for (const item of REVIEW_ITEMS) {
      if (!state.reportReviewedIds.includes(item.key)) dispatch({ type: "TOGGLE_REPORT_REVIEW", reviewId: item.key });
    }
    window.setTimeout(() => dispatch({ type: "MARK_REPORT_REVIEWED" }), 0);
    notify("구급대원 검토가 완료되었습니다.");
  };

  const statusLabel = reportStatus === "confirmed"
    ? state.reportStatus === "closed" ? "사건 기록 종료" : "검토 확정"
    : reportStatus === "reviewing"
      ? "검토 중"
      : "작성 초안";

  return (
    <section className={styles.console} aria-label="EMS Relay 구급활동 보고서 검토 화면">
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}><FileCheck2 size={21} /></span>
          <div>
            <strong>EMS Relay</strong>
            <small>구급활동 기록 검토</small>
          </div>
        </div>

        <nav className={styles.topnav} aria-label="보고서 업무 단계">
          <span><CheckCircle2 size={15} /> 환자 인계</span>
          <ChevronRight size={15} />
          <strong>보고서 검토</strong>
          <ChevronRight size={15} />
          <span data-muted="true">사건 종료</span>
        </nav>

        <div className={styles.account}>
          <span className={styles.connected}><i /> 연결됨</span>
          <span className={styles.avatar}><UserRound size={17} /></span>
          <div><strong>{SCENARIO.unit}</strong><small>구급대원</small></div>
        </div>
      </header>

      <div className={styles.subbar}>
        <button type="button" className={styles.backButton} onClick={() => notify("인계 완료 사건으로 돌아갑니다.")}>
          <span>‹</span> 인계 완료 사건
        </button>
        <div className={styles.caseHeading}>
          <div><strong>{report.caseId}</strong><StatusPill tone={reportStatus === "confirmed" ? "green" : "teal"}>{statusLabel}</StatusPill></div>
          <span><Ambulance size={14} /> {SCENARIO.unit} <i /> 마지막 기록 {report.latestTime}</span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> 인쇄 미리보기</button>
          <button
            type="button"
            onClick={() => {
              setReportStatus((current) => current === "confirmed" ? current : "reviewing");
              notify("현재 검토 상태를 저장했습니다.");
            }}
          ><Save size={16} /> 임시 저장</button>
        </div>
      </div>

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>
            <span>사건 종료 기록</span>
            <strong>작성 문서 <b>2</b></strong>
          </div>
          <button
            type="button"
            className={activeTab === "activity" ? styles.sideActive : ""}
            onClick={() => setActiveTab("activity")}
          >
            <span className={styles.sideIcon}><FileText size={18} /></span>
            <span><strong>구급활동일지</strong><small>대응 작성 초안</small></span>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={activeTab === "cardio" ? styles.sideActive : ""}
            onClick={() => setActiveTab("cardio")}
          >
            <span className={styles.sideIcon}><HeartPulse size={18} /></span>
            <span><strong>심혈관 세부상황표</strong><small>대응 작성 초안</small></span>
            <ChevronRight size={16} />
          </button>

          <div className={styles.completionCard}>
            <div><ClipboardCheck size={18} /><strong>작성 현황</strong></div>
            <dl>
              <div><dt>자동 작성</dt><dd>{autoCount}건</dd></div>
              <div><dt>확인 필요</dt><dd data-tone="amber">{needsReviewCount}건</dd></div>
              <div><dt>미상</dt><dd data-tone="slate">{unknownCount}건</dd></div>
            </dl>
            <div className={styles.progressTrack}><i style={{ width: `${Math.round(((reviewed.size + unknownConfirmed.size) / (REVIEW_ITEMS.length + UNKNOWN_ITEMS.length)) * 100)}%` }} /></div>
            <small>구급대원 확인 {reviewed.size + unknownConfirmed.size}/{REVIEW_ITEMS.length + UNKNOWN_ITEMS.length}</small>
          </div>

          <div className={styles.sourceNote}>
            <ShieldCheck size={17} />
            <p><strong>확정 정보만 사용</strong><span>PTT·직접 입력·업무 버튼 중 사용자가 확인한 기록만 반영됩니다.</span></p>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.documentHeader}>
            <div>
              <span className={styles.eyebrow}>{activeTab === "activity" ? "GENERAL EMS RECORD" : "CARDIOVASCULAR DETAIL"}</span>
              <h1>{activeTab === "activity" ? "구급활동일지 대응 작성 초안" : "심혈관질환 세부상황표 대응 작성 초안"}</h1>
              <p>자동 작성된 내용과 출처를 확인한 후 구급대원이 최종 확정합니다.</p>
            </div>
            <div className={styles.documentStatus}>
              <span><LockKeyhole size={15} /> 인계 완료 시점 기준</span>
              <strong>{report.caseId}</strong>
            </div>
          </div>

          <section className={styles.patientStrip}>
            <div className={styles.patientAvatar}><UserRound size={23} /></div>
            <div className={styles.patientPrimary}><span>환자</span><strong>{report.patient}</strong><small>{report.chiefComplaint}</small></div>
            <div><span>발생 장소</span><strong><MapPin size={14} /> {report.location}</strong></div>
            <div><span>이송 의료기관</span><strong><Hospital size={14} /> {report.hospitalName}</strong></div>
            <StatusPill tone={isCaseComplete ? "green" : "amber"}>{isCaseComplete ? "인계 완료" : "인계 확인 전"}</StatusPill>
          </section>

          <div className={styles.filterRow}>
            <div className={styles.filters} role="group" aria-label="보고서 항목 필터">
              <button type="button" data-active={filter === "all"} onClick={() => setFilter("all")}>전체 항목 <b>{CARDIO_DEMO_REPORT_DRAFT.completion.totalFields}</b></button>
              <button type="button" data-active={filter === "review"} onClick={() => setFilter("review")}>확인 필요 <b data-tone="amber">{needsReviewCount}</b></button>
              <button type="button" data-active={filter === "unknown"} onClick={() => setFilter("unknown")}>미상 <b data-tone="slate">{unknownCount}</b></button>
            </div>
            <span><Info size={14} /> 미상은 임의로 ‘없음’으로 바뀌지 않습니다.</span>
          </div>

          <div className={styles.mainScroll}>
            {filter === "all" ? (
              activeTab === "activity" ? (
                <ActivityReport report={report} state={state} />
              ) : (
                <CardioReport report={report} state={state} />
              )
            ) : null}

            {(filter === "all" || filter === "review") ? (
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><AlertTriangle size={18} /><h2>구급대원 확인 필요</h2><StatusPill tone="amber">{needsReviewCount}건</StatusPill></div>
                  <span>의학적 판단·진술·인수 정보는 자동 확정하지 않습니다.</span>
                </div>
                <div className={styles.reviewGrid}>
                  {REVIEW_ITEMS.map((item) => {
                    const done = reviewed.has(item.key);
                    const value = item.key === "receiver"
                      ? `${report.receiverRole} ${report.receiver}`
                      : item.value;
                    return (
                      <article className={styles.reviewCard} data-done={done} key={item.key}>
                        <button type="button" className={styles.reviewCheck} onClick={() => toggleReview(item.key)} aria-label={`${item.title} 확인`}>
                          {done ? <Check size={15} /> : null}
                        </button>
                        <div><span>{item.title}</span><strong>{value}</strong><small>{item.helper}</small></div>
                        <button type="button" className={styles.sourceButton} onClick={() => notify(`${item.title}의 원 기록을 표시했습니다.`)}>원 기록</button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {(filter === "all" || filter === "unknown") ? (
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><Info size={18} /><h2>미상·평가 불가 항목</h2><StatusPill tone="slate">{unknownCount}건</StatusPill></div>
                  <span>확인할 수 없었던 정보도 기록 상태로 보존합니다.</span>
                </div>
                <div className={styles.unknownTable}>
                  {UNKNOWN_ITEMS.map((item, index) => {
                    const done = unknownConfirmed.has(index);
                    return (
                      <div key={item.label} data-done={done}>
                        <span>{item.label}</span><strong>{item.value}</strong><small>{item.source}</small>
                        <button type="button" onClick={() => confirmUnknown(index)}>{done ? <><Check size={14} /> 확인됨</> : "미상으로 확인"}</button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </main>

        <aside className={styles.reviewPanel}>
          <div className={styles.reviewPanelHeader}>
            <span>FINAL REVIEW</span>
            <h2>보고서 검토</h2>
            <p>자동 작성된 값과 출처를 확인하세요.</p>
          </div>

          <div className={styles.summaryRing} data-complete={reviewComplete && unknownComplete}>
            <span><strong>{reviewed.size + unknownConfirmed.size}</strong><small>/{REVIEW_ITEMS.length + UNKNOWN_ITEMS.length}</small></span>
            <p>필수 확인 항목</p>
          </div>

          <ol className={styles.reviewSteps}>
            <li data-done="true"><span><Check size={13} /></span><div><strong>확정 기록 불러오기</strong><small>사건·환자·측정·회신 이력</small></div></li>
            <li data-done={reviewed.size > 0}><span>{reviewed.size > 0 ? <Check size={13} /> : "2"}</span><div><strong>의학적 항목 확인</strong><small>{needsReviewCount}건 남음</small></div></li>
            <li data-done={unknownComplete}><span>{unknownComplete ? <Check size={13} /> : "3"}</span><div><strong>미상 항목 확인</strong><small>{unknownCount}건 남음</small></div></li>
            <li data-done={reportStatus === "confirmed"}><span>{reportStatus === "confirmed" ? <Check size={13} /> : "4"}</span><div><strong>구급대원 최종 확정</strong><small>확정 후 PDF·JSON 생성</small></div></li>
          </ol>

          <div className={styles.receiverCard}>
            <div><Building2 size={17} /><span><small>환자 인수 의료기관</small><strong>{report.hospitalName}</strong></span></div>
            <dl><div><dt>인수자</dt><dd>{report.receiver}</dd></div><div><dt>직종</dt><dd>{report.receiverRole}</dd></div><div><dt>인계상태</dt><dd>{isCaseComplete ? "확인 완료" : "확인 전"}</dd></div></dl>
          </div>

          <div className={styles.auditNote}>
            <History size={16} />
            <p><strong>수정 이력 보존</strong><span>확정 전·후 변경값과 확인자를 사건 이력에 남깁니다.</span></p>
          </div>

          <div className={styles.panelActions}>
            <button type="button" className={styles.secondaryAction} onClick={() => notify("보고서 초안을 임시 저장했습니다.")}><Save size={16} /> 초안 저장</button>
            <button
              type="button"
              className={styles.primaryAction}
              data-ready={isCaseComplete && reviewComplete && unknownComplete}
              onClick={reportStatus === "confirmed" ? () => { dispatch({ type: "CLOSE_CASE" }); notify("사건 기록을 종료했습니다."); } : confirmReport}
            >
              {state.reportStatus === "closed" ? <><LockKeyhole size={18} /> 사건 기록 종료</> : reportStatus === "confirmed" ? <><BadgeCheck size={18} /> 사건 기록 종료</> : <><ClipboardCheck size={18} /> 검토 완료</>}
            </button>
            <small><LockKeyhole size={12} /> 자동 서명·공식 제출은 수행하지 않습니다.</small>
          </div>
        </aside>
      </div>

      {notice ? <div className={styles.toast} role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
    </section>
  );
}

function ActivityReport({ report, state }: { report: ReportViewModel; state: DemoState }) {
  const events = report.events.slice(-12);
  const visibleEvents = events.length ? events : [{ id: 0, time: "—", actor: "시스템", title: "기록 없음", detail: "사건 진행 시 자동으로 기록됩니다." } as DemoEvent];

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><Activity size={18} /><h2>환자 상태 및 활력징후</h2><StatusPill tone="teal">자동 작성</StatusPill></div>
          <span>최초 측정과 재평가를 덮어쓰지 않고 각각 보존합니다.</span>
        </div>
        <div className={styles.vitalsGrid}>
          {report.vitals.map((vital) => (
            <div key={vital.label}><span>{vital.label}</span><strong>{vital.value}</strong><small>{vital.unit}</small><em>최초 측정</em></div>
          ))}
        </div>
        <div className={styles.reassessmentRow}>
          <span><Clock3 size={15} /> 최근 재평가</span>
          {state.reassessmentVitals ? (
            <><strong>BP {state.reassessmentVitals.bp} mmHg</strong><strong>PR {state.reassessmentVitals.pr}회/분</strong><strong>SpO₂ {state.reassessmentVitals.spo2}%</strong><StatusPill tone="teal">기록됨</StatusPill></>
          ) : (
            <><strong>기록 없음</strong><StatusPill tone="slate">확인 필요</StatusPill></>
          )}
        </div>
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Stethoscope size={18} /><h2>현장 평가·처치</h2></div></div>
          <dl className={styles.detailList}>
            <div><dt>의식 수준</dt><dd>AVPU {displayValue(state.avpu)}</dd><span>구급대원 직접 확인</span></div>
            <div><dt>주요 증상</dt><dd>흉통 · 식은땀 · 오심</dd><span>PTT 후 확인</span></div>
            <div><dt>12유도 심전도</dt><dd>시행 확인 · 상세 소견 미상</dd><span>구급대 기록</span></div>
            <div><dt>시행 처치</dt><dd>심전도 감시 · 정맥로 확보</dd><span>구급대 확인</span></div>
          </dl>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Building2 size={18} /><h2>병원 수용문의·인계</h2></div></div>
          <dl className={styles.detailList}>
            <div><dt>수용 의료기관</dt><dd>{report.hospitalName}</dd><span>병원 회신 후 확정</span></div>
            <div><dt>문의 결과</dt><dd>수용 가능</dd><span>회신 이력 기준</span></div>
            <div><dt>환자 인수자</dt><dd>{report.receiverRole} {report.receiver}</dd><span>병원 입력</span></div>
            <div><dt>인계 상태</dt><dd>{state.stage === "complete" ? "인수 확인 완료" : "인수 확인 전"}</dd><span>업무 버튼 기록</span></div>
          </dl>
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><History size={18} /><h2>사건 타임라인</h2><StatusPill tone="teal">{report.events.length}건</StatusPill></div>
          <span>버튼·확인·병원 회신 시각을 자동으로 기록합니다.</span>
        </div>
        <div className={styles.timeline}>
          {visibleEvents.map((event, index) => {
            const presentation = eventPresentation(event);
            return (
              <div key={`${event.id}-${index}`} data-tone={event.tone ?? "neutral"}>
                <time>{event.time}</time><i /><span><strong>{presentation.title}</strong><small>{presentation.detail}</small></span><em>{presentation.actor}</em>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function CardioReport({ report, state }: { report: ReportViewModel; state: DemoState }) {
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><HeartPulse size={18} /><h2>증상 발생 및 현장평가</h2><StatusPill tone="teal">자동 작성</StatusPill></div>
          <span>확정 진단이 아닌 병원 전 평가 기록입니다.</span>
        </div>
        <div className={styles.cardioHero}>
          <div><span>주호소</span><strong>쥐어짜는 양상의 흉통</strong><small>환자 진술 · PTT 확인</small></div>
          <div><span>증상 발생시각</span><strong>{SCENARIO.onset}</strong><small>{SCENARIO.onsetSource}</small></div>
          <div><span>최초 환자 접촉</span><strong>{report.events.find((event) => event.title === "환자 접촉")?.time ?? "—"}</strong><small>업무 버튼 기록</small></div>
          <div><span>현장 평가</span><strong>급성 관상동맥증후군 의심</strong><small>구급대원 최종 확인 필요</small></div>
        </div>
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Activity size={18} /><h2>흉통·동반증상</h2></div></div>
          <div className={styles.checkTable}>
            <div><span><Check size={13} /></span><strong>흉통</strong><small>쥐어짜는 양상</small></div>
            <div><span><Check size={13} /></span><strong>식은땀</strong><small>동반됨</small></div>
            <div><span><Check size={13} /></span><strong>오심</strong><small>동반됨</small></div>
            <div data-muted="true"><span>—</span><strong>실신</strong><small>확인되지 않음</small></div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Pill size={18} /><h2>과거력·복용약</h2></div></div>
          <dl className={styles.detailList}>
            <div><dt>심혈관 과거력</dt><dd>심부전</dd><span>환자정보 확인본</span></div>
            <div><dt>기타 과거력</dt><dd>당뇨</dd><span>환자정보 확인본</span></div>
            <div><dt>항응고제</dt><dd>와파린 복용 진술</dd><span>약제 확인 필요</span></div>
            <div><dt>알레르기</dt><dd>미상</dd><span>임의 입력 금지</span></div>
          </dl>
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><Hospital size={18} /><h2>심혈관 환자 전달 항목</h2></div><span>병원 전달본과 보고서가 같은 확정 정보를 사용합니다.</span></div>
        <div className={styles.transferGrid}>
          <div><span>최초 혈압</span><strong>{displayValue(state.vitals.bp)} mmHg</strong><small>측정시각과 함께 전달</small></div>
          <div><span>최초 SpO₂</span><strong>{displayValue(state.vitals.spo2)}%</strong><small>산소 투여 전·후 구분 필요</small></div>
          <div><span>12유도 심전도</span><strong>시행 확인 · 상세 소견 미상</strong><small>판독 확정값 아님</small></div>
          <div><span>최종 이송지</span><strong>{report.hospitalName}</strong><small>수용 회신 후 구급대원 확정</small></div>
        </div>
      </section>
    </>
  );
}
