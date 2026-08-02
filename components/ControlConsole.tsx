"use client";

import { useMemo, useState } from "react";
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
  Route,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { HOSPITALS, SCENARIO, STAGE_LABEL, stageAtLeast, useDemo } from "./DemoContext";
import styles from "./ControlConsole.module.css";

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export default function ControlConsole() {
  const { state, dispatch, selectedHospital } = useDemo();
  const [candidate, setCandidate] = useState("hallym");
  const [toast, setToast] = useState<string | null>(null);
  const hasRequest = stageAtLeast(state.stage, "coordination-requested") || state.stage === "declined";

  const availableCandidate = HOSPITALS.find((hospital) => !state.declinedHospitalIds.includes(hospital.id));
  const effectiveCandidateId = state.declinedHospitalIds.includes(candidate) ? (availableCandidate?.id ?? candidate) : candidate;
  const activeCandidate = HOSPITALS.find((hospital) => hospital.id === effectiveCandidateId) ?? HOSPITALS[0];
  const requestState = useMemo(() => {
    if (state.stage === "coordination-requested") return { label: "병원 선택 필요", tone: "amber" as const, detail: "환자 확인본을 읽고 한 병원에 요청하세요." };
    if (state.stage === "declined") return { label: "다음 병원 확인", tone: "red" as const, detail: "이전 수용 곤란 기록을 유지한 채 다음 병원을 선택하세요." };
    if (state.stage === "hospital-requested") return { label: "병원 회신 대기", tone: "amber" as const, detail: "요청과 병원 열람 상태가 자동 동기화됩니다." };
    if (state.stage === "info-requested") return { label: "추가정보 요청", tone: "amber" as const, detail: "병원이 요청한 항목을 구급대 화면에도 즉시 전달했습니다." };
    if (state.stage === "info-sent") return { label: "추가정보 전달됨", tone: "teal" as const, detail: "구급대 답변이 병원 화면에 동기화되었습니다." };
    if (state.stage === "accepted") return { label: "수용 가능", tone: "green" as const, detail: "공식 회신이 구급대 화면에 전달되었습니다." };
    if (state.stage === "destination-confirmed") return { label: "이송지 확인", tone: "green" as const, detail: "구급대가 수용 병원을 이송지로 확인했습니다." };
    if (state.stage === "transporting") return { label: "이송 중", tone: "teal" as const, detail: "ETA와 재평가 정보를 감시합니다." };
    if (state.stage === "hospital-arrived") return { label: "병원 도착", tone: "teal" as const, detail: "구급대가 병원 도착을 확인했습니다." };
    if (state.stage === "handoff-sent") return { label: "인수 확인 대기", tone: "amber" as const, detail: "병원 담당자의 환자 인수 확인을 기다립니다." };
    if (state.stage === "complete") return { label: "조정 종료", tone: "green" as const, detail: "병원이 환자 인수를 확인했습니다." };
    return { label: "요청 대기", tone: "slate" as const, detail: "구급대 평가 완료 후 조정 요청이 표시됩니다." };
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
          <button className={hasRequest && !stageAtLeast(state.stage, "transporting") ? styles.navActive : ""}>병원 조정 {hasRequest && !stageAtLeast(state.stage, "transporting") ? <b>1</b> : null}</button>
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
            <div><span>조정 요청</span><h2>진행 사건 <b>{hasRequest ? 1 : 0}</b></h2></div>
            <button aria-label="요청 새로고침" onClick={() => notify("최신 조정 상태입니다.")}><RefreshCw size={17} /></button>
          </div>
          {hasRequest ? (
            <button className={styles.queueItem}>
              <i data-tone={requestState.tone} />
              <div><span><strong>{SCENARIO.id}</strong><time>{state.events.at(-1)?.time}</time></span><b>{SCENARIO.patient} · 뇌졸중 의심</b><small><Headphones size={13} /> {requestState.label}</small></div>
              <ChevronRight size={18} />
            </button>
          ) : (
            <div className={styles.queueEmpty}><Headphones size={23} /><strong>새 조정 요청이 없습니다</strong><span>구급대가 확인본을 전송하면 여기에 표시됩니다.</span></div>
          )}
          <div className={styles.queueGuide}><span><i data-tone="amber" /> 확인 필요</span><span><i data-tone="teal" /> 진행 중</span><span><i data-tone="green" /> 완료</span></div>
        </aside>

        <main className={styles.caseArea}>
          {!hasRequest ? (
            <div className={styles.emptyCase}>
              <span><RadioTower size={30} /></span>
              <h1>병원 조정 요청을 기다립니다</h1>
              <p>상황실은 환자 임상정보를 작성하지 않습니다.<br />구급대원이 확인한 환자정보가 도착하면 병원 연락만 조정합니다.</p>
              <div><ShieldCheck size={18} /><span><strong>현재 구급대 상태</strong><small>{STAGE_LABEL[state.stage]}</small></span></div>
            </div>
          ) : (
            <>
              <header className={styles.caseHeader}>
                <div><span className={styles.kicker}>중증환자 병원 조정</span><div><h1>{SCENARIO.id}</h1><Badge tone={requestState.tone}>{requestState.label}</Badge></div><p><Ambulance size={15} /> 홍천소방서 구급1대 <MapPin size={15} /> {SCENARIO.locationShort} <Clock3 size={15} /> 최근 갱신 {state.events.at(-1)?.time}</p></div>
                <div className={styles.owner}><Headphones size={18} /><span><small>병원 연락 담당</small><strong>상황실 박○○</strong></span></div>
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
                    <div><span>AVPU</span><strong>{state.avpu}</strong><small>14:29</small></div>
                  </div>
                  <div className={styles.keyFacts}>
                    <div><span>LNT</span><strong>{SCENARIO.lnt}</strong><small>{SCENARIO.lntSource} · 자녀 진술</small></div>
                    <div><span>FAT</span><strong>{SCENARIO.fat}</strong><small>{SCENARIO.fatSource} · 이웃 진술</small></div>
                    <div><span>복용약</span><strong>{SCENARIO.medication}</strong><small>미상으로 전달</small></div>
                  </div>
                </section>

                <section className={styles.candidates}>
                  <div className={styles.sectionTitle}><div><Building2 size={19} /><h2>병원 후보</h2></div><span>거리·ETA·기관정보 참고</span></div>
                  <div className={styles.referenceNotice}><Info size={16} /><span>가까운 순이 추천 순위는 아닙니다. 공공정보만으로 수용 가능 여부를 판단하지 않습니다.</span></div>
                  <div className={styles.candidateList}>
                    {HOSPITALS.map((hospital) => {
                      const declined = state.declinedHospitalIds.includes(hospital.id);
                      const active = state.selectedHospitalId === hospital.id;
                      return (
                        <button className={`${styles.candidateCard} ${effectiveCandidateId === hospital.id ? styles.candidateSelected : ""}`} onClick={() => setCandidate(hospital.id)} disabled={declined || (state.stage !== "coordination-requested" && state.stage !== "declined")} key={hospital.id}>
                          <span className={styles.radio}>{effectiveCandidateId === hospital.id ? <Check size={14} /> : null}</span>
                          <div><strong>{hospital.name}</strong><small>{hospital.type} · {hospital.location}</small><p>{hospital.reference.map((item) => <span key={item}>{item}</span>)}</p></div>
                          <div className={styles.routeInfo}><strong>{hospital.eta}</strong><span>{hospital.distance}</span>{declined ? <Badge tone="red">수용 곤란</Badge> : active ? <Badge tone="amber">요청 중</Badge> : <Badge>수용 확인 전</Badge>}</div>
                        </button>
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
              <span>선택 병원</span><strong>{activeCandidate.name}</strong><p><Route size={15} /> {activeCandidate.distance} · 예상 {activeCandidate.eta}</p>
              <button onClick={() => dispatch({ type: "REQUEST_HOSPITAL", hospitalId: effectiveCandidateId })}><Send size={18} /> 선택 병원에 수용 확인 요청</button>
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
            <div className={styles.transportAction}><Navigation size={23} /><span><strong>{STAGE_LABEL[state.stage]}</strong><small>ETA {selectedHospital?.eta}</small></span><div><span>재평가</span><strong>{state.reassessmentSaved ? "14:52 수신" : "갱신 대기"}</strong></div><div><span>인계</span><strong>{state.stage === "handoff-sent" ? "병원 확인 대기" : "진행 전"}</strong></div></div>
          )}

          {state.stage === "complete" && (
            <div className={styles.completeAction}><CheckCircle2 size={27} /><h2>조정이 종료되었습니다</h2><p>{state.handoffRole} {state.handoffReceiver}<br />15:06 환자 인수 확인</p></div>
          )}

          <div className={styles.boundary}>
            <span><ShieldCheck size={15} /><strong>상황실 역할 범위</strong></span>
            <p>환자정보를 수정하거나 진단하지 않고 병원 요청·회신과 예외 연락만 조정합니다.</p>
          </div>
        </aside>
      </div>
      {toast && <div className={styles.toast} role="status"><CheckCircle2 size={18} /> {toast}</div>}
    </section>
  );
}
