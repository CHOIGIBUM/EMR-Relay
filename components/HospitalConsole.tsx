"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Ambulance,
  Bell,
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
  Phone,
  Send,
  ShieldCheck,
  Stethoscope,
  UserRound,
  X,
} from "lucide-react";
import { SCENARIO, STAGE_LABEL, stageAtLeast, useDemo } from "./DemoContext";
import styles from "./HospitalConsole.module.css";

type Modal = "info" | "accept" | "decline" | null;

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export default function HospitalConsole() {
  const { state, dispatch, selectedHospital } = useDemo();
  const [modal, setModal] = useState<Modal>(null);
  const [infoFields, setInfoFields] = useState<string[]>(["항응고제 복용 여부"]);
  const [declineReason, setDeclineReason] = useState("현재 진료 여력 부족");
  const [receiver, setReceiver] = useState("이○○");
  const [receiverRole, setReceiverRole] = useState("간호사");
  const requestVisible = stageAtLeast(state.stage, "hospital-requested") || state.stage === "declined";
  const timeFor = (...titles: string[]) =>
    [...state.events].reverse().find((event) => titles.includes(event.title))?.time ?? "—";

  useEffect(() => {
    if (state.stage === "hospital-requested" && !state.hospitalViewed) dispatch({ type: "MARK_HOSPITAL_VIEWED" });
  }, [state.stage, state.hospitalViewed, dispatch]);

  const status = useMemo(() => {
    if (state.stage === "hospital-requested") return { label: "검토 필요", tone: "amber" as const, detail: "구급대원 확인본을 검토하고 회신하세요." };
    if (state.stage === "info-requested") return { label: "추가정보 대기", tone: "amber" as const, detail: "요청 항목이 구급대에 전달되었습니다." };
    if (state.stage === "info-sent") return { label: "추가정보 도착", tone: "teal" as const, detail: "구급대 답변을 반영해 다시 검토하세요." };
    if (state.stage === "declined") return { label: "수용 곤란 회신", tone: "red" as const, detail: "상황실에서 다음 병원을 확인 중입니다." };
    if (state.stage === "accepted" || state.stage === "destination-confirmed") return { label: "수용 확정", tone: "green" as const, detail: "구급대의 이송지 확인을 기다립니다." };
    if (state.stage === "transporting") return { label: "환자 이송 중", tone: "teal" as const, detail: "ETA와 재평가 정보를 확인하세요." };
    if (state.stage === "hospital-arrived") return { label: "병원 도착", tone: "teal" as const, detail: "구급대 최종 인계를 기다립니다." };
    if (state.stage === "handoff-sent") return { label: "인수 확인 필요", tone: "amber" as const, detail: "최종 인계 카드를 확인하고 환자를 인수하세요." };
    if (state.stage === "complete") return { label: "인수 완료", tone: "green" as const, detail: "인수자와 시각이 사건 기록에 저장되었습니다." };
    return { label: "요청 대기", tone: "slate" as const, detail: "새 수용 요청이 도착하면 표시됩니다." };
  }, [state.stage]);

  const toggleInfo = (field: string) => {
    setInfoFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  };

  const receive = () => {
    if (!receiver.trim()) return;
    dispatch({ type: "RECEIVE_PATIENT", receiver: receiver.trim(), role: receiverRole });
  };

  return (
    <section className={styles.console} aria-label="EMS Relay 병원 수용 웹 화면">
      <header className={styles.consoleHeader}>
        <div className={styles.brand}>
          <span><Stethoscope size={22} /></span>
          <div><strong>EMS Relay</strong><small>{selectedHospital?.name ?? "병원 수용 콘솔"}</small></div>
        </div>
        <nav aria-label="병원 업무 상태">
          <button className={!requestVisible ? styles.navActive : ""}>요청 대기</button>
          <button className={requestVisible && !stageAtLeast(state.stage, "transporting") ? styles.navActive : ""}>수용 검토 {requestVisible && !stageAtLeast(state.stage, "transporting") && state.stage !== "declined" ? <b>1</b> : null}</button>
          <button className={stageAtLeast(state.stage, "transporting") && state.stage !== "complete" ? styles.navActive : ""}>도착 예정</button>
          <button className={state.stage === "complete" ? styles.navActive : ""}>인수 완료</button>
        </nav>
        <div className={styles.staff}>
          <span className={styles.live}><i /> 실시간 연결</span>
          <button aria-label="알림"><Bell size={18} />{state.stage === "hospital-requested" || state.stage === "info-sent" || state.stage === "handoff-sent" ? <i /> : null}</button>
          <div><span><UserRound size={17} /></span><p><strong>이○○</strong><small>응급실 수용 담당</small></p></div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.queue}>
          <div className={styles.queueTitle}><span>신규 수용 요청</span><h2>대기 <b>{requestVisible && state.stage !== "complete" ? 1 : 0}</b></h2></div>
          {requestVisible ? (
            <button className={styles.queueCard}>
              <i data-tone={status.tone} />
              <div><span><strong>{SCENARIO.id}</strong><time>{state.events.at(-1)?.time}</time></span><b>{SCENARIO.patient}</b><p>{SCENARIO.chiefComplaint}</p><small><Clock3 size={13} /> LNT {SCENARIO.lnt} · ETA {selectedHospital?.eta}</small></div>
              <ChevronRight size={18} />
            </button>
          ) : (
            <div className={styles.queueEmpty}><Hospital size={23} /><strong>새 요청이 없습니다</strong><span>상황실이 수용 확인을 요청하면 표시됩니다.</span></div>
          )}
          <div className={styles.queueRule}><ShieldCheck size={16} /><span><strong>수용 여부는 병원이 직접 회신</strong><small>기관정보나 AI가 대신 판단하지 않습니다.</small></span></div>
        </aside>

        <main className={styles.caseArea}>
          {!requestVisible ? (
            <div className={styles.emptyCase}>
              <span><Hospital size={31} /></span>
              <h1>신규 수용 요청 대기</h1>
              <p>현재 확인할 환자 요청이 없습니다.<br />요청이 도착하면 환자 핵심정보와 필요한 동작만 표시됩니다.</p>
            </div>
          ) : (
            <>
              <header className={styles.caseHeader}>
                <div><span>수용 확인 요청</span><div><h1>{SCENARIO.id}</h1><Badge tone={status.tone}>{status.label}</Badge></div><p><Ambulance size={15} /> 홍천소방서 구급1대 <MapPin size={15} /> {SCENARIO.locationShort} <Clock3 size={15} /> 요청 {timeFor("병원 수용 확인 요청")}</p></div>
                <div className={styles.eta}><span>예상 도착</span><strong>{selectedHospital?.eta ?? "35분"}</strong><small>{state.stage === "transporting" ? "이송 중" : "현장 대기"}</small></div>
              </header>

              <div className={styles.caseScroll}>
                <section className={styles.decisionBanner} data-tone={status.tone}>
                  <span>{status.tone === "green" ? <CheckCircle2 size={22} /> : status.tone === "red" ? <AlertCircle size={22} /> : <Info size={22} />}</span>
                  <div><strong>{status.label}</strong><p>{status.detail}</p></div>
                </section>

                <section className={styles.patientCard}>
                  <div className={styles.sectionTitle}><div><HeartPulse size={19} /><h2>환자 핵심정보</h2></div><Badge tone="teal">구급대원 확인본</Badge></div>
                  <div className={styles.patientLead}>
                    <div><span>급성 뇌졸중 의심</span><h3>{SCENARIO.patient}</h3><p>{SCENARIO.chiefComplaint}</p></div>
                    <div><span>CPSS 양성</span><span>Pre-KTAS {SCENARIO.preKtas}</span><span>AVPU {state.avpu}</span></div>
                  </div>
                  <div className={styles.vitals}>
                    <div><span>혈압 BP</span><strong>{state.vitals.bp}</strong><small>mmHg</small></div>
                    <div><span>맥박 PR</span><strong>{state.vitals.pr}</strong><small>회/분</small></div>
                    <div><span>호흡수 RR</span><strong>{state.vitals.rr}</strong><small>회/분</small></div>
                    <div><span>SpO₂</span><strong>{state.vitals.spo2}</strong><small>%</small></div>
                    <div><span>혈당 BST</span><strong>{state.vitals.glucose}</strong><small>mg/dL</small></div>
                  </div>
                  <div className={styles.clinicalRows}>
                    <div><span>LNT</span><strong>{SCENARIO.lnt}</strong><small>{SCENARIO.lntSource} · 자녀 진술</small></div>
                    <div><span>FAT</span><strong>{SCENARIO.fat}</strong><small>{SCENARIO.fatSource} · 이웃 진술</small></div>
                    <div><span>CPSS</span><strong>얼굴 우측 · 팔 우측 · 말 어눌함</strong><small>구급대원 직접 확인</small></div>
                    <div><span>기저질환</span><strong>{SCENARIO.history.join(" · ")}</strong><small>환자·약 봉투 확인</small></div>
                    <div data-tone="unknown"><span>복용약</span><strong>{state.infoReply ?? SCENARIO.medication}</strong><small>{state.infoReply ? `${timeFor("추가정보 회신")} 구급대 회신` : "현재 미상"}</small></div>
                    <div data-tone="unknown"><span>알레르기</span><strong>{SCENARIO.allergy}</strong><small>미상으로 전달됨</small></div>
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
                    <div className={styles.routePanel}><div className={styles.map}><span><Ambulance size={17} /></span><i /><b><Hospital size={17} /></b></div><div><span>현재 ETA</span><strong>{selectedHospital?.eta}</strong><small>{SCENARIO.locationShort} → {selectedHospital?.name}</small></div></div>
                    {state.reassessmentSaved && <div className={styles.updateLine}><Activity size={16} /><strong>{timeFor("이송 중 재평가")} 재평가</strong><span>AVPU A · BP 180/98 mmHg · SpO₂ 97% · 증상 지속</span></div>}
                  </section>
                )}

                {stageAtLeast(state.stage, "hospital-arrived") && state.stage !== "declined" && (
                  <section className={styles.handoffCard}>
                    <div className={styles.sectionTitle}><div><ClipboardCheck size={19} /><h2>최종 인계 카드</h2></div><Badge tone={state.stage === "complete" ? "green" : "amber"}>{state.stage === "complete" ? "인수 완료" : state.stage === "handoff-sent" ? "인수 확인 필요" : "인계 대기"}</Badge></div>
                    <dl>
                      <div><dt>환자</dt><dd>{SCENARIO.patient} · {SCENARIO.living}</dd></div>
                      <div><dt>주증상</dt><dd>{SCENARIO.chiefComplaint}</dd></div>
                      <div><dt>LNT / FAT</dt><dd>{SCENARIO.lnt} / {SCENARIO.fat}</dd></div>
                      <div><dt>최초 활력</dt><dd>BP {state.vitals.bp} · PR {state.vitals.pr} · SpO₂ {state.vitals.spo2}%</dd></div>
                      <div><dt>재평가</dt><dd>{state.reassessmentSaved ? "AVPU A · BP 180/98 · 증상 지속" : "추가 기록 없음"}</dd></div>
                      <div><dt>미상</dt><dd>항응고제 · 알레르기</dd></div>
                    </dl>
                  </section>
                )}
              </div>
            </>
          )}
        </main>

        <aside className={styles.actionPanel}>
          <div className={styles.actionHeader}><span>현재 할 일</span><Badge tone={status.tone}>{status.label}</Badge></div>
          <div className={styles.actionState} data-tone={status.tone}>
            <span>{status.tone === "green" ? <CheckCircle2 size={25} /> : status.tone === "red" ? <AlertCircle size={25} /> : <Stethoscope size={25} />}</span>
            <h2>{status.label}</h2><p>{status.detail}</p>
          </div>

          {(state.stage === "hospital-requested" || state.stage === "info-sent") && (
            <div className={styles.decisionActions}>
              <button className={styles.acceptButton} onClick={() => setModal("accept")}><CheckCircle2 size={19} /> 수용 가능</button>
              <button onClick={() => setModal("info")}><MessageSquareText size={18} /> 추가정보 요청</button>
              <button className={styles.declineButton} onClick={() => setModal("decline")}><X size={18} /> 수용 곤란</button>
            </div>
          )}

          {state.stage === "info-requested" && (
            <div className={styles.waitingAction}><span className={styles.pulse} /><strong>구급대 답변 대기</strong><p>{state.requestedInfo.join(" · ")}</p></div>
          )}

          {(state.stage === "accepted" || state.stage === "destination-confirmed") && (
            <div className={styles.acceptedAction}><CheckCircle2 size={25} /><strong>수용 가능 회신 완료</strong><p>응급실 구급차 출입구<br />도착 전 연락 요청</p><Badge tone="green">상황실·구급대 전달됨</Badge></div>
          )}

          {(state.stage === "transporting" || state.stage === "hospital-arrived") && (
            <div className={styles.transportAction}><Navigation size={25} /><strong>{STAGE_LABEL[state.stage]}</strong><p>ETA {selectedHospital?.eta}<br />최근 갱신 {state.reassessmentSaved ? timeFor("이송 중 재평가") : timeFor("이송 시작")}</p><button><Phone size={16} /> 구급대 전화</button></div>
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

          <div className={styles.boundary}><ShieldCheck size={16} /><span><strong>병원 역할 범위</strong><small>구급대 평가값은 수정하지 않고 수용 여부와 인수만 확인합니다.</small></span></div>
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
                  {["항응고제 복용 여부", "LNT 재확인", "최근 활력징후", "기존 뇌졸중 후유장애"].map((field) => <button className={infoFields.includes(field) ? styles.infoSelected : ""} onClick={() => toggleInfo(field)} key={field}><span>{infoFields.includes(field) ? <Check size={15} /> : null}</span>{field}</button>)}
                </div>
                <button className={styles.modalPrimary} disabled={!infoFields.length} onClick={() => { dispatch({ type: "REQUEST_INFO", fields: infoFields }); setModal(null); }}><Send size={18} /> 선택 항목 요청</button>
              </>
            )}
            {modal === "accept" && (
              <>
                <span className={`${styles.modalIcon} ${styles.acceptIcon}`}><CheckCircle2 size={25} /></span><h2>수용 가능으로 회신</h2><p>구급대와 상황실에 다음 안내가 전달됩니다.</p>
                <div className={styles.replyPreview}><span>진입 위치</span><strong>응급실 구급차 출입구</strong><span>연락</span><strong>도착 전 구급대 전화</strong><span>담당</span><strong>응급실 이○○</strong></div>
                <button className={styles.modalPrimary} onClick={() => { dispatch({ type: "ACCEPT" }); setModal(null); }}><CheckCircle2 size={18} /> 수용 가능 회신</button>
              </>
            )}
            {modal === "decline" && (
              <>
                <span className={`${styles.modalIcon} ${styles.declineIcon}`}><AlertCircle size={25} /></span><h2>수용 곤란 사유</h2><p>상황실이 다음 병원에 연락할 수 있도록 사유를 남깁니다.</p>
                <div className={styles.declineChoices}>{["현재 진료 여력 부족", "관련 진료과 대응 곤란", "장비·시설 사용 곤란", "기타"].map((reason) => <button className={declineReason === reason ? styles.declineSelected : ""} onClick={() => setDeclineReason(reason)} key={reason}>{declineReason === reason ? <Check size={15} /> : null}{reason}</button>)}</div>
                <button className={`${styles.modalPrimary} ${styles.modalDanger}`} onClick={() => { dispatch({ type: "DECLINE", reason: declineReason }); setModal(null); }}><X size={18} /> 수용 곤란 회신</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
