"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Ambulance,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  HeartPulse,
  Hospital,
  Info,
  MapPin,
  MessageSquareText,
  Navigation,
  Send,
  Stethoscope,
  X,
} from "lucide-react";
import { STAGE_LABEL, stageAtLeast, useDemo } from "./DemoContext";
import styles from "./HospitalConsole.module.css";

type Modal = "info" | "accept" | "decline" | null;

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export default function HospitalConsole() {
  const { state, dispatch, selectedHospital, scenario: SCENARIO } = useDemo();
  const [modal, setModal] = useState<Modal>(null);
  const [infoFields, setInfoFields] = useState<string[]>([]);
  const [declineReason, setDeclineReason] = useState("");
  const [receiver, setReceiver] = useState("");
  const [receiverRole, setReceiverRole] = useState("간호사");
  const requestVisible = stageAtLeast(state.stage, "hospital-requested") || state.stage === "declined";
  const arrivedAtHospital = stageAtLeast(state.stage, "hospital-arrived") && state.stage !== "declined";
  const timeFor = (...titles: string[]) =>
    [...state.events].reverse().find((event) => titles.includes(event.title))?.time ?? "—";

  useEffect(() => {
    if (state.stage === "hospital-requested" && !state.hospitalViewed) dispatch({ type: "MARK_HOSPITAL_VIEWED" });
  }, [state.stage, state.hospitalViewed, dispatch]);

  const status = useMemo(() => {
    if (state.stage === "hospital-requested") return { label: "검토 필요", tone: "amber" as const, detail: "구급대원 확인본을 검토하고 회신하세요." };
    if (state.stage === "info-requested") return { label: "추가정보 대기", tone: "amber" as const, detail: "요청 항목이 구급대에 전달되었습니다." };
    if (state.stage === "info-sent") return { label: "추가정보 도착", tone: "teal" as const, detail: "구급대 답변을 반영해 다시 검토하세요." };
    if (state.stage === "declined") return { label: "수용 곤란 회신", tone: "red" as const, detail: "구급대가 사유를 확인하고 다음 병원을 검토합니다." };
    if (state.stage === "accepted" || state.stage === "destination-confirmed") return { label: "수용 가능 회신", tone: "green" as const, detail: "구급대의 이송지 확인을 기다립니다." };
    if (state.stage === "transporting") return { label: "환자 이송 중", tone: "teal" as const, detail: "ETA와 재평가 정보를 확인하세요." };
    if (state.stage === "hospital-arrived") return { label: "병원 도착", tone: "teal" as const, detail: "구급대 최종 인계를 기다립니다." };
    if (state.stage === "handoff-sent") return { label: "인수 확인 필요", tone: "amber" as const, detail: "최종 인계 카드를 확인하고 환자를 인수하세요." };
    if (state.stage === "complete") return { label: "인수 완료", tone: "green" as const, detail: "인수자와 시각이 사건 기록에 저장되었습니다." };
    return { label: "요청 대기", tone: "slate" as const, detail: "새 수용 요청이 도착하면 표시됩니다." };
  }, [state.stage]);

  const toggleInfo = (field: string) => {
    setInfoFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  };

  const openModal = (next: Exclude<Modal, null>) => {
    if (next === "info") setInfoFields([]);
    if (next === "decline") setDeclineReason("");
    setModal(next);
  };

  const receive = () => {
    if (!receiver.trim()) return;
    dispatch({ type: "RECEIVE_PATIENT", receiver: receiver.trim(), role: receiverRole });
  };

  if (!requestVisible) {
    return (
      <section className={`${styles.console} ${styles.emptyConsole}`} aria-label="EMS Relay 병원 수용 웹 화면">
        <div className={styles.emptyWorkspace}>
          <span className={styles.emptyIcon}><Hospital size={32} /></span>
          <h1>수용 요청 대기</h1>
          <p>새 요청이 도착하면 자동으로 표시됩니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.console} aria-label="EMS Relay 병원 수용 웹 화면">
      <div className={styles.workspace}>
        <aside className={styles.queue}>
          <div className={styles.queueTitle}><span>신규 수용 요청</span><h2>대기 <b>{requestVisible && state.stage !== "complete" ? 1 : 0}</b></h2></div>
          {requestVisible ? (
            <article className={styles.queueCard} aria-label={`${SCENARIO.id} 수용 요청`}>
              <i data-tone={status.tone} />
              <div><span><strong>{SCENARIO.id}</strong><time>{state.events.at(-1)?.time}</time></span><b>{SCENARIO.patient}</b><p>{SCENARIO.chiefComplaint}</p><small><Clock3 size={13} /> 발생 {SCENARIO.onset} · {arrivedAtHospital ? "도착 확인" : `ETA ${selectedHospital?.eta ?? "—"}`}</small></div>
              <ChevronRight size={18} />
            </article>
          ) : (
            <div className={styles.queueEmpty}><Hospital size={23} /><strong>새 요청이 없습니다</strong><span>구급대가 수용 확인을 요청하면 표시됩니다.</span></div>
          )}
        </aside>

        <main className={styles.caseArea}>
              <header className={styles.caseHeader}>
                <div><span>수용 문의</span><div><h1>{SCENARIO.id}</h1><Badge tone={status.tone}>{status.label}</Badge></div><p><Ambulance size={15} /> {SCENARIO.unit} <MapPin size={15} /> {SCENARIO.locationShort} <Clock3 size={15} /> 요청 {timeFor("병원 수용 문의")}</p></div>
                <div className={styles.eta}><span>{arrivedAtHospital ? "도착 상태" : "예상 도착"}</span><strong>{arrivedAtHospital ? "도착" : selectedHospital?.eta ?? "경로 조회 전"}</strong><small>{arrivedAtHospital ? timeFor("병원 도착") : state.stage === "transporting" ? "이송 중" : "현장 대기"}</small></div>
              </header>

              <div className={styles.caseScroll}>
                <section className={styles.decisionBanner} data-tone={status.tone}>
                  <span>{status.tone === "green" ? <CheckCircle2 size={22} /> : status.tone === "red" ? <AlertCircle size={22} /> : <Info size={22} />}</span>
                  <div><strong>{status.label}</strong><p>{status.detail}</p></div>
                </section>

                <section className={styles.patientCard}>
                  <div className={styles.sectionTitle}><div><HeartPulse size={19} /><h2>환자 핵심정보</h2></div><Badge tone="teal">구급대원 확인본</Badge></div>
                  <div className={styles.patientLead}>
                    <div><span>{SCENARIO.impression}</span><h3>{SCENARIO.patient}</h3><p>{SCENARIO.chiefComplaint}</p></div>
                    <div><span>확정 진단 아님</span><span>흉통 NRS {SCENARIO.pain.severityNrs}</span><span>AVPU {state.avpu}</span></div>
                  </div>
                  <div className={styles.vitals}>
                    <div><span>혈압 BP</span><strong>{state.vitals.bp}</strong><small>mmHg</small></div>
                    <div><span>맥박 PR</span><strong>{state.vitals.pr}</strong><small>회/분</small></div>
                    <div><span>호흡수 RR</span><strong>{state.vitals.rr}</strong><small>회/분</small></div>
                    <div><span>SpO₂</span><strong>{state.vitals.spo2}</strong><small>%</small></div>
                    <div><span>혈당</span><strong>{state.vitals.glucose}</strong><small>mg/dL</small></div>
                  </div>
                  <div className={styles.clinicalRows}>
                    <div><span>증상 발생</span><strong>{SCENARIO.onset}</strong><small>{SCENARIO.onsetSource}</small></div>
                    <div><span>동반증상</span><strong>{SCENARIO.symptoms.join(" · ") || "미확인"}</strong><small>환자 진술·현장 관찰</small></div>
                    <div><span>흉통</span><strong>{SCENARIO.pain.region} · {SCENARIO.pain.radiation} 방사</strong><small>NRS {SCENARIO.pain.severityNrs} · {SCENARIO.pain.quality}</small></div>
                    <div><span>기저질환</span><strong>{SCENARIO.history.join(" · ") || "미확인"}</strong><small>환자·보호자 진술</small></div>
                    <div data-tone="unknown"><span>복용약</span><strong>{SCENARIO.medication}</strong><small>진술 기반 · 약제 확인 필요</small></div>
                    <div data-tone="unknown"><span>미상 항목</span><strong>{SCENARIO.unresolvedItems.join(" · ")}</strong><small>임의로 보완하지 않음</small></div>
                  </div>
                </section>

                {state.infoReply && (
                  <section className={styles.newInfo}>
                    <span><MessageSquareText size={21} /></span><div><small>{timeFor("추가정보 회신")} 구급대 추가정보</small><strong>{state.infoReply}</strong><p>미확인 사실을 임의로 확정하지 않고 미상으로 전달했습니다.</p></div><Badge tone="teal">새 정보</Badge>
                  </section>
                )}

                {stageAtLeast(state.stage, "transporting") && state.stage !== "declined" && (
                  <section className={styles.incomingCard}>
                    <div className={styles.sectionTitle}><div><Navigation size={19} /><h2>도착 예정</h2></div><Badge tone={state.stage === "complete" ? "green" : "teal"}>{STAGE_LABEL[state.stage]}</Badge></div>
                    <div className={styles.routePanel}><div className={styles.map}><span><Ambulance size={17} /></span><i /><b><Hospital size={17} /></b></div><div><span>{arrivedAtHospital ? "도착" : "현재 ETA"}</span><strong>{arrivedAtHospital ? "도착 확인" : selectedHospital?.eta ?? "—"}</strong><small>{SCENARIO.locationShort} → {selectedHospital?.name}</small></div></div>
                    {state.reassessmentVitals && <div className={styles.updateLine}><Activity size={16} /><strong>{timeFor("이송 중 재평가", "이송 전 재평가 확인", "추가정보 회신")} 재평가</strong><span>AVPU {state.avpu} · BP {state.reassessmentVitals.bp} mmHg · SpO₂ {state.reassessmentVitals.spo2}% · {state.reassessmentSummary}</span></div>}
                  </section>
                )}

                {stageAtLeast(state.stage, "hospital-arrived") && state.stage !== "declined" && (
                  <section className={styles.handoffCard}>
                    <div className={styles.sectionTitle}><div><ClipboardCheck size={19} /><h2>최종 인계 카드</h2></div><Badge tone={state.stage === "complete" ? "green" : "amber"}>{state.stage === "complete" ? "인수 완료" : state.stage === "handoff-sent" ? "인수 확인 필요" : "인계 대기"}</Badge></div>
                    <dl>
                      <div><dt>환자</dt><dd>{SCENARIO.patient} · {SCENARIO.living}</dd></div>
                      <div><dt>주증상</dt><dd>{SCENARIO.chiefComplaint}</dd></div>
                      <div><dt>ABC</dt><dd>A {SCENARIO.primarySurvey.airway} · B {SCENARIO.primarySurvey.breathing} · C {SCENARIO.primarySurvey.circulation}</dd></div>
                      <div><dt>발생시각</dt><dd>{SCENARIO.onset} · {SCENARIO.onsetSource}</dd></div>
                      <div><dt>최초 활력</dt><dd>BP {state.vitals.bp} · PR {state.vitals.pr} · SpO₂ {state.vitals.spo2}%</dd></div>
                      <div><dt>재평가</dt><dd>{state.reassessmentVitals ? `AVPU ${state.avpu} · BP ${state.reassessmentVitals.bp} · ${state.reassessmentSummary}` : "추가 기록 없음"}</dd></div>
                      <div><dt>미상</dt><dd>{SCENARIO.unresolvedItems.join(" · ") || "기록 없음"}</dd></div>
                    </dl>
                  </section>
                )}
              </div>
        </main>

        <aside className={styles.actionPanel}>
          <div className={styles.actionHeader}><span>현재 할 일</span><Badge tone={status.tone}>{status.label}</Badge></div>
          <div className={styles.actionState} data-tone={status.tone}>
            <span>{status.tone === "green" ? <CheckCircle2 size={25} /> : status.tone === "red" ? <AlertCircle size={25} /> : <Stethoscope size={25} />}</span>
            <h2>{status.label}</h2><p>{status.detail}</p>
          </div>

          {(state.stage === "hospital-requested" || state.stage === "info-sent") && (
            <div className={styles.decisionActions}>
              <button className={styles.acceptButton} onClick={() => openModal("accept")}><CheckCircle2 size={19} /> 수용 가능</button>
              <button onClick={() => openModal("info")}><MessageSquareText size={18} /> 추가정보 요청</button>
              <button className={styles.declineButton} onClick={() => openModal("decline")}><X size={18} /> 수용 곤란</button>
            </div>
          )}

          {state.stage === "info-requested" && (
            <div className={styles.waitingAction}><span className={styles.pulse} /><strong>구급대 답변 대기</strong><p>{state.requestedInfo.join(" · ")}</p></div>
          )}

          {(state.stage === "accepted" || state.stage === "destination-confirmed") && (
            <div className={styles.acceptedAction}><CheckCircle2 size={25} /><strong>수용 가능 회신 완료</strong><p>수용 가능 회신이 구급대와 상황실에 공유되었습니다.</p><Badge tone="green">구급대 전달 · 상황실 공유</Badge></div>
          )}

          {(state.stage === "transporting" || state.stage === "hospital-arrived") && (
            <div className={styles.transportAction}><Navigation size={25} /><strong>{STAGE_LABEL[state.stage]}</strong><p>{arrivedAtHospital ? `도착 ${timeFor("병원 도착")}` : `ETA ${selectedHospital?.eta ?? "—"}`}<br />최근 갱신 {state.reassessmentSaved ? timeFor("이송 중 재평가", "이송 전 재평가 확인", "추가정보 회신") : timeFor("이송 시작")}</p></div>
          )}

          {state.stage === "handoff-sent" && (
            <div className={styles.receiveForm}>
              <span>환자 인수 확인</span>
              <label><small>인수자 성명</small><input value={receiver} onChange={(event) => setReceiver(event.target.value)} /></label>
              <label><small>직종</small><select value={receiverRole} onChange={(event) => setReceiverRole(event.target.value)}><option>간호사</option><option>의사</option><option>1급 응급구조사</option><option>기타</option></select></label>
              <button disabled={!receiver.trim()} onClick={receive}><ClipboardCheck size={18} /> 환자 인수 확인</button>
              <p>병원 인수 확인 후에만 사건이 종료됩니다.</p>
            </div>
          )}

          {state.stage === "complete" && (
            <div className={styles.completeAction}><CheckCircle2 size={29} /><h2>환자 인수 완료</h2><p>{state.handoffRole} {state.handoffReceiver}<br />{timeFor("환자 인수 확인")} 확인</p></div>
          )}

        </aside>
      </div>

      {modal && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setModal(null)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label={modal === "info" ? "추가정보 요청" : modal === "accept" ? "수용 가능 회신" : "수용 곤란 회신"} onMouseDown={(event) => event.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setModal(null)} aria-label="닫기"><X size={19} /></button>
            {modal === "info" && (
              <>
                <span className={styles.modalIcon}><MessageSquareText size={24} /></span><h2>추가정보 요청</h2><p>현재 판단에 필요한 항목만 선택하세요.</p>
                <div className={styles.infoChoices}>
                  {["재평가 활력징후", "12유도 심전도 상세 소견", "항혈소판제·항응고제 복용", "약물 알레르기"].map((field) => <button className={infoFields.includes(field) ? styles.infoSelected : ""} onClick={() => toggleInfo(field)} key={field}><span>{infoFields.includes(field) ? <Check size={15} /> : null}</span>{field}</button>)}
                </div>
                <button className={styles.modalPrimary} disabled={!infoFields.length} onClick={() => { dispatch({ type: "REQUEST_INFO", fields: infoFields }); setModal(null); }}><Send size={18} /> 선택 항목 요청</button>
              </>
            )}
            {modal === "accept" && (
              <>
                <span className={`${styles.modalIcon} ${styles.acceptIcon}`}><CheckCircle2 size={25} /></span><h2>수용 가능으로 회신</h2><p>수용 가능 회신이 구급대와 상황실에 공유됩니다.</p>
                <button className={styles.modalPrimary} onClick={() => { dispatch({ type: "ACCEPT" }); setModal(null); }}><CheckCircle2 size={18} /> 수용 가능 회신</button>
              </>
            )}
            {modal === "decline" && (
              <>
                <span className={`${styles.modalIcon} ${styles.declineIcon}`}><AlertCircle size={25} /></span><h2>수용 곤란 사유</h2><p>구급대가 다음 병원을 검토할 수 있도록 사유를 남깁니다.</p>
                <div className={styles.declineChoices}>{["현재 진료 여력 부족", "관련 진료과 대응 곤란", "장비·시설 사용 곤란", "기타"].map((reason) => <button className={declineReason === reason ? styles.declineSelected : ""} onClick={() => setDeclineReason(reason)} key={reason}>{declineReason === reason ? <Check size={15} /> : null}{reason}</button>)}</div>
                <button className={`${styles.modalPrimary} ${styles.modalDanger}`} disabled={!declineReason.trim()} onClick={() => { if (!declineReason.trim()) return; dispatch({ type: "DECLINE", reason: declineReason.trim() }); setModal(null); }}><X size={18} /> 수용 곤란 회신</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
