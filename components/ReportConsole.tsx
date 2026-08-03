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
import { CARDIO_DEMO_REPORT_DRAFT, useDemo, type DemoEvent, type DemoState, type ScenarioView } from "./DemoContext";
import type { OperationalAnnex5Draft } from "@/lib/operationalTypes";
import styles from "./ReportConsole.module.css";

type ReportTab = "activity" | "cardio";
type ReviewFilter = "all" | "review" | "unknown";
type ReportStatus = "draft" | "reviewing" | "confirmed";
type ReviewKey =
  | "patientIdentity"
  | "symptomsAndOccurrence"
  | "patientAssessment"
  | "paramedicAssessment"
  | "emergencyCare"
  | "medicalDirection"
  | "transport"
  | "handoff";

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
  helper: string;
}> = [
  {
    key: "patientIdentity",
    title: "환자 인적사항",
    helper: "연령과 성별을 환자·보호자 또는 신분 확인 결과와 대조합니다.",
  },
  {
    key: "symptomsAndOccurrence",
    title: "증상·발생시각",
    helper: "주호소와 마지막 정상 확인 시각의 근거를 확인합니다.",
  },
  {
    key: "patientAssessment",
    title: "환자 평가",
    helper: "AVPU와 최초·재평가 활력징후의 측정값·시각을 확인합니다.",
  },
  {
    key: "paramedicAssessment",
    title: "구급대원 평가",
    helper: "현장 소견은 확정 진단이 아니며 관찰 근거를 확인합니다.",
  },
  {
    key: "emergencyCare",
    title: "응급처치",
    helper: "실제로 시행한 처치와 약물만 기록되었는지 확인합니다.",
  },
  {
    key: "medicalDirection",
    title: "의료지도",
    helper: "의료지도 시행 여부와 지도 내용을 확인합니다.",
  },
  {
    key: "transport",
    title: "이송 의료기관",
    helper: "최종 수용 회신과 실제 이송지를 대조합니다.",
  },
  {
    key: "handoff",
    title: "환자 인계",
    helper: "인수자·직종·인계 완료 시각을 확인합니다.",
  },
];

function reportSectionValue(key: ReviewKey, draft: OperationalAnnex5Draft | undefined, report: ReportViewModel) {
  if (!draft) {
    if (key === "patientIdentity") return report.patient;
    if (key === "symptomsAndOccurrence") return report.chiefComplaint;
    if (key === "transport") return report.hospitalName;
    if (key === "handoff") return `${report.receiverRole} ${report.receiver}`;
    return "사건 기록에서 확인";
  }
  const simple = (record: Record<string, unknown>) => Object.values(record)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(String)
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ") || "기록 없음";
  if (key === "patientAssessment") {
    const first = draft.patientAssessment.vitalSigns[0] ?? {};
    const avpu = draft.patientAssessment.consciousness.avpu;
    const bp = first.systolicBp && first.diastolicBp ? `BP ${first.systolicBp}/${first.diastolicBp} mmHg` : "혈압 미입력";
    return [`AVPU ${String(avpu ?? "미상")}`, bp, first.pulse ? `PR ${first.pulse}회/분` : ""].filter(Boolean).join(" · ");
  }
  return simple(draft[key] as Record<string, unknown>);
}

const DEMO_UNKNOWN_ITEMS = [
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
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
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
  scenarioSource: Record<string, unknown>,
  draft?: OperationalAnnex5Draft,
): ReportViewModel {
  const scenario = scenarioSource;
  const identity = draft?.patientIdentity ?? {};
  const symptoms = draft?.symptomsAndOccurrence ?? {};
  const transport = draft?.transport ?? {};
  const handoff = draft?.handoff ?? {};
  const firstVitals = draft?.patientAssessment.vitalSigns[0] ?? {};
  const receiver = displayValue(handoff.receiverName, displayValue(state.handoffReceiver, "미입력"));
  const receiverRole = cleanText(handoff.receiverRole, cleanText(state.handoffRole, "직종 미입력"));
  const identityText = [identity.age ? `${String(identity.age)}세` : "", identity.sex ? String(identity.sex) : ""].filter(Boolean).join(" ");

  return {
    caseId: cleanText(draft?.dispatchTimeline.caseId, cleanText(scenario.id, "—")),
    patient: identityText || cleanText(scenario.patient, "미입력"),
    location: cleanText(scenario.location, "확인 필요"),
    chiefComplaint: cleanText(symptoms.chiefComplaint, cleanText(scenario.chiefComplaint, "미입력")),
    hospitalName: cleanText(transport.primaryDestinationHospitalName, cleanText(selectedHospital?.name, "미확정")),
    receiver,
    receiverRole,
    vitals: [
      { label: "혈압", value: firstVitals.systolicBp && firstVitals.diastolicBp ? `${firstVitals.systolicBp}/${firstVitals.diastolicBp}` : displayValue(state.vitals.bp), unit: "mmHg" },
      { label: "맥박", value: displayValue(firstVitals.pulse, displayValue(state.vitals.pr)), unit: "회/분" },
      { label: "호흡수", value: displayValue(firstVitals.respiratoryRate, displayValue(state.vitals.rr)), unit: "회/분" },
      { label: "SpO₂", value: displayValue(firstVitals.spo2, displayValue(state.vitals.spo2)), unit: "%" },
      { label: "체온", value: displayValue(firstVitals.temperature, displayValue(state.vitals.temp)), unit: "℃" },
      { label: "혈당", value: displayValue(firstVitals.glucose, displayValue(state.vitals.glucose)), unit: "mg/dL" },
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
  const { state, selectedHospital, dispatch, scenario: SCENARIO, sync } = useDemo();
  const [activeTab, setActiveTab] = useState<ReportTab>("activity");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [reportStatus, setReportStatus] = useState<ReportStatus>("draft");
  const [reviewed, setReviewed] = useState<Set<ReviewKey>>(new Set());
  const [unknownConfirmed, setUnknownConfirmed] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const report = useMemo(
    () => toReportViewModel(state, selectedHospital, SCENARIO as unknown as Record<string, unknown>, sync.report?.draft),
    [state, selectedHospital, SCENARIO, sync.report?.draft],
  );
  const unknownItems = useMemo(() => {
    if (sync.mode === "demo") return DEMO_UNKNOWN_ITEMS;
    return (sync.report?.draft.missingFields ?? []).map((field) => ({
      label: field,
      value: "미입력",
      source: "보고서 초안의 누락 항목",
    }));
  }, [sync.mode, sync.report?.draft.missingFields]);
  const isCaseComplete = state.stage === "complete";
  const reviewComplete = reviewed.size === REVIEW_ITEMS.length;
  const unknownComplete = unknownConfirmed.size === unknownItems.length;
  const autoCount = sync.mode === "demo"
    ? CARDIO_DEMO_REPORT_DRAFT.completion.autoFilledFields
    : sync.report ? Math.max(0, REVIEW_ITEMS.length - new Set(sync.report.draft.missingFields.map((field) => field.split(".")[0])).size) : 0;
  const totalFieldCount = sync.mode === "demo" ? CARDIO_DEMO_REPORT_DRAFT.completion.totalFields : REVIEW_ITEMS.length + unknownItems.length;
  const needsReviewCount = REVIEW_ITEMS.length - reviewed.size;
  const unknownCount = Math.max(0, unknownItems.length - unknownConfirmed.size);

  useEffect(() => {
    if (state.stage === "complete" && state.reportStatus === "ready") dispatch({ type: "CREATE_REPORT" });
  }, [state.stage, state.reportStatus, dispatch]);

  useEffect(() => {
    if (!sync.report) return;
    const timer = window.setTimeout(() => {
      setReviewed(new Set(sync.report?.reviewedFields.filter((field): field is ReviewKey => REVIEW_ITEMS.some((item) => item.key === field)) ?? []));
      setReportStatus(sync.report?.status === "FINALIZED" ? "confirmed" : sync.report?.status === "IN_REVIEW" ? "reviewing" : "draft");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sync.report]);

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
    window.setTimeout(() => dispatch({ type: "MARK_REPORT_REVIEWED", reviewedFields: REVIEW_ITEMS.map((item) => item.key) }), 0);
    notify("구급대원 검토가 완료되었습니다.");
  };

  const statusLabel = reportStatus === "confirmed"
    ? state.reportStatus === "closed" ? "사건 기록 종료" : "검토 확정"
    : reportStatus === "reviewing"
      ? "검토 중"
      : "작성 초안";

  return (
    <section className={styles.console} aria-label="EMS Relay 구급활동 보고서 검토 화면">
      <div className={styles.subbar}>
        <div className={styles.caseHeading}>
          <span className={styles.pageLabel}>구급활동 기록 검토</span>
          <div><strong>{report.caseId}</strong><StatusPill tone={reportStatus === "confirmed" ? "green" : "teal"}>{statusLabel}</StatusPill></div>
          <span><Ambulance size={14} /> {SCENARIO.unit} <i /> 마지막 기록 {report.latestTime}</span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> 인쇄 미리보기</button>
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
            <div className={styles.progressTrack}><i style={{ width: `${Math.round(((reviewed.size + unknownConfirmed.size) / Math.max(1, REVIEW_ITEMS.length + unknownItems.length)) * 100)}%` }} /></div>
            <small>구급대원 확인 {reviewed.size + unknownConfirmed.size}/{REVIEW_ITEMS.length + unknownItems.length}</small>
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
              <button type="button" data-active={filter === "all"} onClick={() => setFilter("all")}>전체 항목 <b>{totalFieldCount}</b></button>
              <button type="button" data-active={filter === "review"} onClick={() => setFilter("review")}>확인 필요 <b data-tone="amber">{needsReviewCount}</b></button>
              <button type="button" data-active={filter === "unknown"} onClick={() => setFilter("unknown")}>미상 <b data-tone="slate">{unknownCount}</b></button>
            </div>
            <span><Info size={14} /> 미상은 임의로 ‘없음’으로 바뀌지 않습니다.</span>
          </div>

          <div className={styles.mainScroll}>
            {filter === "all" ? (
              activeTab === "activity" ? (
                <ActivityReport report={report} state={state} scenario={SCENARIO} />
              ) : (
                <CardioReport report={report} state={state} scenario={SCENARIO} />
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
                    const value = reportSectionValue(item.key, sync.report?.draft, report);
                    return (
                      <article className={styles.reviewCard} data-done={done} key={item.key}>
                        <button type="button" className={styles.reviewCheck} onClick={() => toggleReview(item.key)} aria-label={`${item.title} 확인`}>
                          {done ? <Check size={15} /> : null}
                        </button>
                        <div><span>{item.title}</span><strong>{value}</strong><small>{item.helper}</small></div>
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
                  {unknownItems.map((item, index) => {
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
            <span><strong>{reviewed.size + unknownConfirmed.size}</strong><small>/{REVIEW_ITEMS.length + unknownItems.length}</small></span>
            <p>필수 확인 항목</p>
          </div>

          <ol className={styles.reviewSteps}>
            <li data-done="true"><span><Check size={13} /></span><div><strong>확정 기록 불러오기</strong><small>사건·환자·측정·회신 이력</small></div></li>
            <li data-done={reviewed.size > 0}><span>{reviewed.size > 0 ? <Check size={13} /> : "2"}</span><div><strong>의학적 항목 확인</strong><small>{needsReviewCount}건 남음</small></div></li>
            <li data-done={unknownComplete}><span>{unknownComplete ? <Check size={13} /> : "3"}</span><div><strong>미상 항목 확인</strong><small>{unknownCount}건 남음</small></div></li>
            <li data-done={reportStatus === "confirmed"}><span>{reportStatus === "confirmed" ? <Check size={13} /> : "4"}</span><div><strong>구급대원 최종 확정</strong><small>확정 후 인쇄본·JSON 보관</small></div></li>
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
            <button
              type="button"
              className={styles.primaryAction}
              data-ready={isCaseComplete && reviewComplete && unknownComplete}
              disabled={sync.pending}
              onClick={reportStatus === "confirmed" ? () => { dispatch({ type: "CLOSE_CASE" }); notify("사건 기록을 종료했습니다."); } : confirmReport}
            >
              {sync.pending ? <><Save size={18} /> 저장 중</> : state.reportStatus === "closed" ? <><LockKeyhole size={18} /> 사건 기록 종료</> : reportStatus === "confirmed" ? <><BadgeCheck size={18} /> 사건 기록 종료</> : <><ClipboardCheck size={18} /> 검토 완료</>}
            </button>
            <small><LockKeyhole size={12} /> 자동 서명·공식 제출은 수행하지 않습니다.</small>
          </div>
        </aside>
      </div>

      <section className={styles.officialPrint} aria-label="구급활동일지 인쇄본">
        <div className={styles.printTitle}><h1>구급활동일지</h1><span>사건번호 {report.caseId}</span></div>
        <table><tbody>
          <tr><th>소방기관</th><td>{displayValue(sync.report?.draft.administrative.organization, SCENARIO.unit)}</td><th>구급차량</th><td>{displayValue(sync.report?.draft.administrative.vehicleNumber, "미입력")}</td><th>담당</th><td>구급대원</td><th>결재</th><td>　　　　　　</td></tr>
          <tr><th>신고접수</th><td>{report.events.find((event) => event.title.includes("신고"))?.time ?? "—"}</td><th>출동</th><td>{report.events.find((event) => event.title.includes("출동 시작"))?.time ?? "—"}</td><th>현장도착</th><td>{report.events.find((event) => event.title.includes("현장 도착"))?.time ?? "—"}</td><th>병원도착</th><td>{report.events.find((event) => event.title.includes("병원 도착"))?.time ?? "—"}</td></tr>
        </tbody></table>
        <h2>환자 인적사항</h2>
        <table><tbody><tr><th>성명</th><td>미상</td><th>연령·성별</th><td>{report.patient}</td><th>발생장소</th><td colSpan={3}>{report.location}</td></tr></tbody></table>
        <h2>증상 및 발생유형</h2>
        <table><tbody><tr><th>주호소</th><td colSpan={3}>{report.chiefComplaint}</td><th>발생시각</th><td>{SCENARIO.onset}</td><th>발생유형</th><td>{displayValue(sync.report?.draft.symptomsAndOccurrence.occurrenceType, "확인 필요")}</td></tr></tbody></table>
        <h2>환자평가</h2>
        <table><tbody>
          <tr><th>AVPU</th><td>{state.avpu}</td><th>동공</th><td>미상</td><th>중증도 LEVEL</th><td>구급대원 확인 필요</td><th>평가시각</th><td>{report.latestTime}</td></tr>
          <tr><th>최초 활력</th><td colSpan={3}>BP {report.vitals[0].value} mmHg · PR {report.vitals[1].value}회/분 · RR {report.vitals[2].value}회/분 · SpO₂ {report.vitals[3].value}%</td><th>재평가</th><td colSpan={3}>{state.reassessmentVitals ? `BP ${state.reassessmentVitals.bp} mmHg · PR ${state.reassessmentVitals.pr}회/분 · SpO₂ ${state.reassessmentVitals.spo2}%` : "기록 없음"}</td></tr>
        </tbody></table>
        <h2>구급대원 평가 및 응급처치</h2>
        <table><tbody>
          <tr><th>현장평가</th><td colSpan={3}>{SCENARIO.impression} (확정 진단 아님)</td><th>발생시각 근거</th><td colSpan={3}>{SCENARIO.onsetSource}</td></tr>
          <tr><th>응급처치</th><td colSpan={3}>{SCENARIO.interventions.join(" · ")}</td><th>의료지도</th><td colSpan={3}>기록 없음 · 확인 필요</td></tr>
        </tbody></table>
        <h2>이송 및 인계</h2>
        <table><tbody>
          <tr><th>1차 이송기관</th><td colSpan={3}>{report.hospitalName}</td><th>2차·재이송</th><td>기록 없음 · 확인 필요</td><th>재이송 사유</th><td>기록 없음 · 확인 필요</td></tr>
          <tr><th>환자 인수자</th><td>{report.receiver}</td><th>직종</th><td>{report.receiverRole}</td><th>인계상태</th><td>{state.stage === "complete" ? "인수 확인 완료" : "확인 전"}</td><th>인계시각</th><td>{report.latestTime}</td></tr>
        </tbody></table>
        <h2>공동대응 및 출동사항</h2>
        <table><tbody>
          <tr><th>공동대응</th><td>기록 없음 · 확인 필요</td><th>미이송</th><td>기록 없음 · 확인 필요</td><th>출동인원</th><td>구급대원 확인 필요</td><th>장애요인</th><td>기록 없음</td></tr>
        </tbody></table>
        <p className={styles.printFoot}>확정된 사건 기록으로 자동 작성된 초안이며, 담당 구급대원의 최종 확인 후 사용합니다.</p>
      </section>

      {notice ? <div className={styles.toast} role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
    </section>
  );
}

function ActivityReport({ report, state, scenario }: { report: ReportViewModel; state: DemoState; scenario: ScenarioView }) {
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
            <div><dt>주요 증상</dt><dd>{scenario.symptoms.join(" · ") || report.chiefComplaint}</dd><span>확인된 사건 기록</span></div>
            <div><dt>12유도 심전도</dt><dd>{scenario.interventions.find((item) => item.includes("심전도")) ?? "기록 없음"}</dd><span>확인된 처치 기록</span></div>
            <div><dt>시행 처치</dt><dd>{scenario.interventions.join(" · ") || "기록 없음"}</dd><span>확인된 사건 기록</span></div>
          </dl>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Building2 size={18} /><h2>병원 수용문의·인계</h2></div></div>
          <dl className={styles.detailList}>
            <div><dt>수용 의료기관</dt><dd>{report.hospitalName}</dd><span>병원 회신 후 확정</span></div>
            <div><dt>문의 결과</dt><dd>{state.destinationConfirmed ? "수용 회신 후 이송지 확인" : "회신 확인 전"}</dd><span>회신 이력 기준</span></div>
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

function CardioReport({ report, state, scenario }: { report: ReportViewModel; state: DemoState; scenario: ScenarioView }) {
  const ecgRecord = scenario.interventions.find((item) => item.includes("심전도")) ?? "기록 없음";
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><HeartPulse size={18} /><h2>증상 발생 및 현장평가</h2><StatusPill tone="teal">자동 작성</StatusPill></div>
          <span>확정 진단이 아닌 병원 전 평가 기록입니다.</span>
        </div>
        <div className={styles.cardioHero}>
          <div><span>주호소</span><strong>{report.chiefComplaint}</strong><small>확인된 사건 기록</small></div>
          <div><span>증상 발생시각</span><strong>{scenario.onset}</strong><small>{scenario.onsetSource}</small></div>
          <div><span>최초 환자 접촉</span><strong>{report.events.find((event) => event.title === "환자 접촉")?.time ?? "—"}</strong><small>업무 버튼 기록</small></div>
          <div><span>현장 평가</span><strong>{scenario.impression}</strong><small>구급대원 최종 확인 필요</small></div>
        </div>
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Activity size={18} /><h2>흉통·동반증상</h2></div></div>
          <div className={styles.checkTable}>
            {scenario.symptoms.length ? scenario.symptoms.map((symptom) => (
              <div key={symptom}><span><Check size={13} /></span><strong>{symptom}</strong><small>확인된 사건 기록</small></div>
            )) : <div data-muted="true"><span>—</span><strong>동반증상 기록 없음</strong><small>미확인을 ‘없음’으로 판단하지 않음</small></div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><Pill size={18} /><h2>과거력·복용약</h2></div></div>
          <dl className={styles.detailList}>
            <div><dt>기저질환</dt><dd>{scenario.history.join(" · ") || "미확인"}</dd><span>확인된 환자정보</span></div>
            <div><dt>복용약</dt><dd>{scenario.medication}</dd><span>약제 확인 필요</span></div>
            <div><dt>알레르기</dt><dd>{scenario.allergy}</dd><span>임의 입력 금지</span></div>
          </dl>
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><Hospital size={18} /><h2>심혈관 환자 전달 항목</h2></div><span>병원 전달본과 보고서가 같은 확정 정보를 사용합니다.</span></div>
        <div className={styles.transferGrid}>
          <div><span>최초 혈압</span><strong>{displayValue(state.vitals.bp)} mmHg</strong><small>측정시각과 함께 전달</small></div>
          <div><span>최초 SpO₂</span><strong>{displayValue(state.vitals.spo2)}%</strong><small>산소 투여 전·후 구분 필요</small></div>
          <div><span>12유도 심전도</span><strong>{ecgRecord}</strong><small>확인된 기록만 표시</small></div>
          <div><span>최종 이송지</span><strong>{report.hospitalName}</strong><small>수용 회신 후 구급대원 확정</small></div>
        </div>
      </section>
    </>
  );
}
