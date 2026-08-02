"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Ambulance,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Info,
  MapPin,
  Navigation,
  Phone,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { HOSPITALS, SCENARIO, STAGE_LABEL, stageAtLeast, useDemo, type HospitalOption } from "./DemoContext";
import styles from "./ControlConsole.module.css";

const API_BASE = (process.env.NEXT_PUBLIC_EMS_API_BASE ?? "/api/local").replace(/\/$/, "");

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export default function ControlConsole() {
  const { state, selectedHospital } = useDemo();
  const [hospitalOptions, setHospitalOptions] = useState<HospitalOption[]>(HOSPITALS);
  const [directoryState, setDirectoryState] = useState<"idle" | "ready" | "fallback">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const hasRequest = stageAtLeast(state.stage, "coordination-requested") || state.stage === "declined";
  const timeFor = (...titles: string[]) =>
    [...state.events].reverse().find((event) => titles.includes(event.title))?.time ?? "—";

  useEffect(() => {
    if (!hasRequest) return;

    const controller = new AbortController();
    fetch(`${API_BASE}/hospitals?lat=37.748&lng=127.849&case=${SCENARIO.id}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`병원정보 조회 실패: ${response.status}`);
        return response.json() as Promise<{ hospitals?: HospitalOption[] }>;
      })
      .then((payload) => {
        if (payload.hospitals?.length) setHospitalOptions(payload.hospitals);
        setDirectoryState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHospitalOptions(HOSPITALS);
        setDirectoryState("fallback");
      });

    return () => controller.abort();
  }, [hasRequest]);

  const requestState = useMemo(() => {
    if (state.stage === "coordination-requested") return { label: "연락 지원 요청", tone: "amber" as const, detail: "구급대가 병원 문의 지원을 요청했습니다. 임상 판단이나 이송지 선택 없이 연락을 지원합니다." };
    if (state.stage === "declined") return { label: "재문의 지원", tone: "red" as const, detail: "구급대가 수용 곤란 사유를 확인하고 다음 병원을 검토합니다." };
    if (state.stage === "hospital-requested") return { label: "병원 회신 대기", tone: "amber" as const, detail: "요청과 병원 열람 상태가 자동 동기화됩니다." };
    if (state.stage === "info-requested") return { label: "추가정보 요청", tone: "amber" as const, detail: "병원이 요청한 항목을 구급대 화면에도 즉시 전달했습니다." };
    if (state.stage === "info-sent") return { label: "추가정보 전달됨", tone: "teal" as const, detail: "구급대 답변이 병원 화면에 동기화되었습니다." };
    if (state.stage === "accepted") return { label: "수용 가능", tone: "green" as const, detail: "공식 회신이 구급대 화면에 전달되었습니다." };
    if (state.stage === "destination-confirmed") return { label: "이송지 확인", tone: "green" as const, detail: "구급대가 수용 병원을 이송지로 확인했습니다." };
    if (state.stage === "transporting") return { label: "이송 중", tone: "teal" as const, detail: "ETA와 재평가 정보를 감시합니다." };
    if (state.stage === "hospital-arrived") return { label: "병원 도착", tone: "teal" as const, detail: "구급대가 병원 도착을 확인했습니다." };
    if (state.stage === "handoff-sent") return { label: "인수 확인 대기", tone: "amber" as const, detail: "병원 담당자의 환자 인수 확인을 기다립니다." };
    if (state.stage === "complete") return { label: "조정 종료", tone: "green" as const, detail: "병원이 환자 인수를 확인했습니다." };
    return { label: "요청 대기", tone: "slate" as const, detail: "구급대가 병원 문의를 시작하면 진행 상태가 표시됩니다." };
  }, [state.stage]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2300);
  };

  return (
    <section className={styles.console} aria-label="EMS Relay 이송조정 상황실 화면">
      <header className={styles.consoleHeader}>
        <div className={styles.consoleBrand}>
          <span><RadioTower size={22} /></span>
          <div><strong>EMS Relay</strong><small>이송조정 상황실</small></div>
        </div>
        <nav aria-label="상황실 업무 상태">
          <button className={!hasRequest ? styles.navActive : ""}>요청 대기</button>
          <button className={hasRequest && !stageAtLeast(state.stage, "transporting") ? styles.navActive : ""}>이송 지원 {hasRequest && !stageAtLeast(state.stage, "transporting") ? <b>1</b> : null}</button>
          <button className={state.stage === "transporting" || state.stage === "hospital-arrived" || state.stage === "handoff-sent" ? styles.navActive : ""}>이송·인계</button>
          <button className={state.stage === "complete" ? styles.navActive : ""}>종료</button>
        </nav>
        <div className={styles.operator}>
          <span className={styles.live}><i /> 실시간 연결</span>
          <button aria-label="알림"><Bell size={18} />{state.stage === "coordination-requested" ? <i /> : null}</button>
          <div><span><UserRound size={17} /></span><p><strong>박○○</strong><small>이송조정 담당</small></p></div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.queue}>
          <div className={styles.queueTitle}>
            <div><span>공유 사건</span><h2>진행 사건 <b>{hasRequest ? 1 : 0}</b></h2></div>
            <button aria-label="요청 새로고침" onClick={() => notify("최신 조정 상태입니다.")}><RefreshCw size={17} /></button>
          </div>
          {hasRequest ? (
            <button className={styles.queueItem}>
              <i data-tone={requestState.tone} />
              <div><span><strong>{SCENARIO.id}</strong><time>{state.events.at(-1)?.time}</time></span><b>{SCENARIO.patient} · 뇌졸중 의심</b><small><Headphones size={13} /> {requestState.label}</small></div>
              <ChevronRight size={18} />
            </button>
          ) : (
            <div className={styles.queueEmpty}><Headphones size={23} /><strong>지원 중인 사건이 없습니다</strong><span>구급대가 병원 문의를 시작하면 여기에 표시됩니다.</span></div>
          )}
          <div className={styles.queueGuide}><span><i data-tone="amber" /> 확인 필요</span><span><i data-tone="teal" /> 진행 중</span><span><i data-tone="green" /> 완료</span></div>
        </aside>

        <main className={styles.caseArea}>
          {!hasRequest ? (
            <div className={styles.emptyCase}>
              <span><RadioTower size={30} /></span>
              <h1>구급대 병원 문의를 기다립니다</h1>
              <p>상황실은 환자 임상정보나 이송지를 결정하지 않습니다.<br />진행 지연과 반복 거절을 감시하고 필요할 때 연락을 지원합니다.</p>
              <div><ShieldCheck size={18} /><span><strong>현재 구급대 상태</strong><small>{STAGE_LABEL[state.stage]}</small></span></div>
            </div>
          ) : (
            <>
              <header className={styles.caseHeader}>
                <div><span className={styles.kicker}>중증환자 이송 지원</span><div><h1>{SCENARIO.id}</h1><Badge tone={requestState.tone}>{requestState.label}</Badge></div><p><Ambulance size={15} /> 홍천소방서 구급1대 <MapPin size={15} /> {SCENARIO.locationShort} <Clock3 size={15} /> 최근 갱신 {state.events.at(-1)?.time}</p></div>
                <div className={styles.owner}><Headphones size={18} /><span><small>예외 연락 지원</small><strong>상황실 박○○</strong></span></div>
              </header>

              <div className={styles.caseScroll}>
                <section className={styles.patientSummary}>
                  <div className={styles.sectionTitle}><div><Activity size={19} /><h2>구급대원 환자 확인본</h2></div><Badge tone="teal">읽기 전용</Badge></div>
                  <div className={styles.patientLead}>
                    <div><span>현재 환자 상태</span><h3>{SCENARIO.patient}</h3><p>{SCENARIO.chiefComplaint}</p></div>
                    <div><span>급성 뇌졸중 의심</span><span>CPSS 양성</span><span>Pre-KTAS {SCENARIO.preKtas}</span></div>
                  </div>
                  <div className={styles.vitals}>
                    <div><span>BP</span><strong>{state.vitals.bp}</strong><small>mmHg</small></div>
                    <div><span>PR</span><strong>{state.vitals.pr}</strong><small>회/분</small></div>
                    <div><span>RR</span><strong>{state.vitals.rr}</strong><small>회/분</small></div>
                    <div><span>SpO₂</span><strong>{state.vitals.spo2}</strong><small>%</small></div>
                    <div><span>BST</span><strong>{state.vitals.glucose}</strong><small>mg/dL</small></div>
                    <div><span>AVPU</span><strong>{state.avpu}</strong><small>{timeFor("최초 활력징후 확인", "뇌졸중 선별정보 확인")}</small></div>
                  </div>
                  <div className={styles.keyFacts}>
                    <div><span>LNT</span><strong>{SCENARIO.lnt}</strong><small>{SCENARIO.lntSource} · 자녀 진술</small></div>
                    <div><span>FAT</span><strong>{SCENARIO.fat}</strong><small>{SCENARIO.fatSource} · 이웃 진술</small></div>
                    <div><span>복용약</span><strong>{SCENARIO.medication}</strong><small>미상으로 전달</small></div>
                  </div>
                </section>

                <section className={styles.candidates}>
                  <div className={styles.sectionTitle}><div><Building2 size={19} /><h2>구급대 표시 병원 후보</h2></div><span>{directoryState === "idle" ? "기관정보 조회 중" : directoryState === "fallback" ? "로컬 예비정보" : "거리·ETA·기관정보 참고"}</span></div>
                  <div className={styles.referenceNotice}><Info size={16} /><span>가까운 순이 추천 순위는 아닙니다. 공공정보만으로 수용 가능 여부를 판단하지 않습니다.</span></div>
                  <div className={styles.candidateList}>
                    {hospitalOptions.map((hospital) => {
                      const declined = state.declinedHospitalIds.includes(hospital.id);
                      const active = state.selectedHospitalId === hospital.id;
                      return (
                        <div className={`${styles.candidateCard} ${active ? styles.candidateSelected : ""}`} key={hospital.id}>
                          <span className={styles.radio}>{active ? <Check size={14} /> : null}</span>
                          <div><strong>{hospital.name}</strong><small>{hospital.type} · {hospital.location}</small><p>{hospital.reference.map((item) => <span key={item}>{item}</span>)}</p></div>
                          <div className={styles.routeInfo}><strong>{hospital.eta}</strong><span>{hospital.distance}</span>{declined ? <Badge tone="red">수용 곤란</Badge> : active ? <Badge tone="amber">요청 중</Badge> : <Badge>수용 확인 전</Badge>}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className={styles.ledger}>
                  <div className={styles.sectionTitle}><div><FileText size={19} /><h2>요청·회신 원장</h2></div><span>같은 사건 기록</span></div>
                  <div className={styles.ledgerList}>
                    {[...state.events].reverse().filter((event) => ["이송조정 상황실", "병원", "구급대원"].includes(event.actor)).map((event) => (
                      <div className={styles.ledgerItem} key={event.id}><time>{event.time}</time><i data-tone={event.tone ?? "slate"} /><span><strong>{event.title}</strong><small>{event.detail}</small></span><Badge tone={event.actor === "병원" ? "amber" : event.actor === "구급대원" ? "teal" : "slate"}>{event.actor}</Badge></div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </main>

        <aside className={styles.actionPanel}>
          <div className={styles.actionHeader}><span>현재 할 일</span><Badge tone={requestState.tone}>{requestState.label}</Badge></div>
          <div className={styles.actionState} data-tone={requestState.tone}>
            <span>{requestState.tone === "green" ? <CheckCircle2 size={25} /> : requestState.tone === "red" ? <AlertCircle size={25} /> : <Headphones size={25} />}</span>
            <h2>{requestState.label}</h2>
            <p>{requestState.detail}</p>
          </div>

          {(state.stage === "coordination-requested" || state.stage === "declined") && (
            <div className={styles.selectedRequest}>
              <span>구급대 진행</span><strong>{state.stage === "declined" ? "다음 병원 검토 중" : "연락 지원 요청 수신"}</strong><p>병원 선택과 수용 문의 발송은 구급대 모바일에서 수행합니다.</p>
              <button onClick={() => notify("구급대 연락 지원을 시작합니다.")}><Phone size={18} /> 구급대 연락 지원</button>
            </div>
          )}

          {state.stage === "hospital-requested" && (
            <div className={styles.waitingAction}><span className={styles.pulse} /><strong>{selectedHospital?.name}</strong><p>병원 담당자의 열람과 회신을 기다립니다.</p><button onClick={() => notify("전화 연결 결과를 요청 원장에 기록할 수 있습니다.")}><Phone size={17} /> 전화 연결</button></div>
          )}

          {state.stage === "info-requested" && (
            <div className={styles.infoAction}><span>병원 요청 항목</span><strong>{state.requestedInfo.join(" · ")}</strong><p>요청 내용이 구급대 모바일에 자동 공유되었습니다.</p><Badge tone="amber">구급대 답변 대기</Badge></div>
          )}

          {state.stage === "info-sent" && (
            <div className={styles.infoAction}><span>구급대 회신</span><strong>{state.infoReply}</strong><p>병원 화면에 자동 전달되었습니다.</p><Badge tone="teal">병원 재검토 중</Badge></div>
          )}

          {(state.stage === "accepted" || state.stage === "destination-confirmed") && (
            <div className={styles.acceptedAction}><CheckCircle2 size={23} /><span><strong>{selectedHospital?.name}</strong><small>병원 공식 회신 · 수용 가능</small></span><p>응급실 구급차 출입구<br />도착 전 연락</p><Badge tone="green">구급대 전달 완료</Badge></div>
          )}

          {stageAtLeast(state.stage, "transporting") && state.stage !== "complete" && (
            <div className={styles.transportAction}><Navigation size={23} /><span><strong>{STAGE_LABEL[state.stage]}</strong><small>ETA {selectedHospital?.eta}</small></span><div><span>재평가</span><strong>{state.reassessmentSaved ? `${timeFor("이송 중 재평가")} 수신` : "갱신 대기"}</strong></div><div><span>인계</span><strong>{state.stage === "handoff-sent" ? "병원 확인 대기" : "진행 전"}</strong></div></div>
          )}

          {state.stage === "complete" && (
            <div className={styles.completeAction}><CheckCircle2 size={27} /><h2>조정이 종료되었습니다</h2><p>{state.handoffRole} {state.handoffReceiver}<br />{timeFor("환자 인수 확인")} 환자 인수 확인</p></div>
          )}

          <div className={styles.boundary}>
            <span><ShieldCheck size={15} /><strong>상황실 역할 범위</strong></span>
            <p>환자정보·임상 판단·이송지를 대신 결정하지 않고 지연·반복 거절 등 예외 상황의 연락을 지원합니다.</p>
          </div>
        </aside>
      </div>
      {toast && <div className={styles.toast} role="status"><CheckCircle2 size={18} /> {toast}</div>}
    </section>
  );
}
