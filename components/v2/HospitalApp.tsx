"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Hospital,
  MapPin,
  Navigation,
  RefreshCw,
  Stethoscope,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  isV2NetworkHospitalId,
  V2_DEMO_HOSPITALS,
  V2_HOSPITAL_NETWORK_ID,
  V2_NETWORK_HOSPITAL_IDS,
} from "@/lib/v2/hospitalDirectory";
import type { HospitalDecision, HospitalInboxItem } from "@/lib/v2/types";
import Brand from "./Brand";
import PatientCard from "./PatientCard";
import { useV2 } from "./V2Provider";
import styles from "./V2.module.css";

const statusLabel = {
  REQUESTED: "신규",
  VIEWED: "열람 중",
  ACCEPTED: "수용 가능",
  DECLINED: "수용 곤란",
  CLOSED: "요청 종료",
} as const;

export default function HospitalApp() {
  const auth = useAuth();
  const { api, store, loading, pending, error, refresh, run, selectHospitalRealtimeScope } = useV2();
  const accountHospitalId = auth.user?.institutionId ?? "";
  const isNetworkAccount = accountHospitalId === V2_HOSPITAL_NETWORK_ID;
  const networkHospitals = useMemo(() => V2_DEMO_HOSPITALS.map((fallback) => (
    store?.hospitals.find((hospital) => hospital.id === fallback.id) ?? fallback
  )), [store?.hospitals]);
  const defaultHospitalId = isNetworkAccount
    ? V2_NETWORK_HOSPITAL_IDS[0]
    : accountHospitalId || store?.hospitals[0]?.id || "";
  const [hospitalId, setHospitalId] = useState(defaultHospitalId);
  const [inbox, setInbox] = useState<HospitalInboxItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [decision, setDecision] = useState<HospitalDecision | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const inboxLoadSequence = useRef(0);
  const activeHospitalId = useRef(defaultHospitalId);

  const effectiveHospitalId = isNetworkAccount && isV2NetworkHospitalId(hospitalId)
    ? hospitalId
    : defaultHospitalId;

  useEffect(() => {
    if (!effectiveHospitalId) return;
    activeHospitalId.current = effectiveHospitalId;
    selectHospitalRealtimeScope(effectiveHospitalId);
    return () => { inboxLoadSequence.current += 1; };
  }, [effectiveHospitalId, selectHospitalRealtimeScope]);

  const loadInbox = useCallback(async () => {
    if (!effectiveHospitalId) return;
    const requestedHospitalId = effectiveHospitalId;
    const sequence = ++inboxLoadSequence.current;
    try {
      const nextInbox = await api.listHospitalInbox(requestedHospitalId);
      if (sequence !== inboxLoadSequence.current || activeHospitalId.current !== requestedHospitalId) return;
      setInbox(nextInbox);
      setInboxError(null);
    } catch (reason) {
      if (sequence !== inboxLoadSequence.current || activeHospitalId.current !== requestedHospitalId) return;
      setInboxError(reason instanceof Error ? reason.message : "수용 요청 목록을 갱신하지 못했습니다.");
    }
  }, [api, effectiveHospitalId]);

  const changeHospital = useCallback((nextHospitalId: string) => {
    if (!isNetworkAccount || !isV2NetworkHospitalId(nextHospitalId)) return;
    inboxLoadSequence.current += 1;
    activeHospitalId.current = nextHospitalId;
    setHospitalId(nextHospitalId);
    setInbox([]);
    setSelectedRequestId(null);
    setDecision(null);
    setInboxError(null);
    selectHospitalRealtimeScope(nextHospitalId);
  }, [isNetworkAccount, selectHospitalRealtimeScope]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadInbox(), 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadInbox();
    }, 2_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadInbox, store?.updatedAt]);

  const selected = inbox.find((item) => item.request.id === selectedRequestId) ?? null;
  const institution = store?.hospitals.find((item) => item.id === effectiveHospitalId)
    ?? networkHospitals.find((item) => item.id === effectiveHospitalId)
    ?? inbox.find((item) => item.hospital.id === effectiveHospitalId)?.hospital
    ?? null;
  const isDestination = Boolean(selected && selected.incident.destinationRequestId === selected.request.id);

  const openRequest = async (item: HospitalInboxItem) => {
    setSelectedRequestId(item.request.id);
    if (item.request.status === "REQUESTED") {
      try { await run(() => api.markRequestViewed(item.incident.id, item.request.id, effectiveHospitalId)); } catch { /* Provider shows the error. */ }
    }
  };

  const sendDecision = async () => {
    if (!selected || !decision) return;
    try {
      await run(() => api.respondToRequest(selected.incident.id, selected.request.id, effectiveHospitalId, decision));
      setDecision(null);
    } catch { /* Provider shows the error. */ }
  };

  const counts = useMemo(() => ({
    new: inbox.filter((item) => item.request.status === "REQUESTED").length,
    active: inbox.filter((item) => ["REQUESTED", "VIEWED"].includes(item.request.status)).length,
  }), [inbox]);

  if (error && !store) return (
    <main className={styles.hospitalShell}>
      <Brand subtitle="병원 수용 담당" />
      <div className={styles.loadFailure} role="alert">
        <AlertTriangle />
        <strong>수용 요청을 불러오지 못했습니다</strong>
        <p>{error}</p>
        <button type="button" onClick={() => void refresh()}><RefreshCw /> 다시 시도</button>
      </div>
    </main>
  );
  if (loading || !store) return <main className={styles.hospitalShell}><Brand subtitle="병원 수용 담당" /><div className={styles.loading}>수용 요청을 불러오고 있습니다.</div></main>;

  return (
    <main className={styles.hospitalShell}>
      <Brand
        subtitle="병원 수용 담당"
        hospitalContext={{
          id: effectiveHospitalId,
          name: institution?.name ?? auth.user?.displayName ?? effectiveHospitalId,
          ...(isNetworkAccount ? {
            options: networkHospitals.map(({ id, name }) => ({ id, name })),
            onChange: changeHospital,
          } : {}),
        }}
      />
      <div className={styles.hospitalToolbar}>
        <div><Stethoscope /><span><small>현재 기관</small><strong>{institution?.name ?? "기관 확인 필요"}</strong></span></div>
        <button type="button" onClick={() => void refresh()}><RefreshCw /> 새로고침</button>
      </div>
      {error ? <div className={styles.desktopError} role="alert"><AlertTriangle /> {error}</div> : null}
      {inboxError ? <div className={styles.desktopError} role="alert"><AlertTriangle /> {inboxError} <button type="button" onClick={() => void loadInbox()}>다시 시도</button></div> : null}

      <div className={styles.hospitalWorkspace}>
        <aside className={styles.inbox}>
          <div className={styles.inboxHeading}><div><small>수용 요청</small><h1>대기 {counts.active}</h1></div>{counts.new ? <b>{counts.new} NEW</b> : null}</div>
          <div className={styles.inboxCards}>
            {inbox.length ? inbox.map((item) => (
              <button type="button" key={item.request.id} data-selected={item.request.id === selectedRequestId} data-status={item.request.status} onClick={() => void openRequest(item)}>
                <div><strong>{item.incident.code}</strong><span>{statusLabel[item.request.status]}</span></div>
                <h2>{item.incident.patientCard ? `${item.incident.patientCard.age}세 · ${item.incident.patientCard.sex === "female" ? "여성" : item.incident.patientCard.sex === "male" ? "남성" : "미상"}` : "환자 카드 확인 전"}</h2>
                <p>{item.incident.patientCard?.chiefComplaint ?? item.incident.reportSummary}</p>
                <footer><Clock3 /> ETA {item.request.etaMinutes}분 <ChevronRight /></footer>
              </button>
            )) : <div className={styles.emptyInbox}><Hospital /><strong>새 요청이 없습니다</strong><span>구급대가 요청하면 자동으로 표시됩니다.</span></div>}
          </div>
        </aside>

        <section className={styles.reviewWorkspace}>
          {selected?.incident.patientCard ? (
            <>
              <div className={styles.reviewTitle}><div><small>환자 카드 확인</small><h1>{selected.incident.code}</h1></div><span data-status={selected.request.status}>{statusLabel[selected.request.status]}</span></div>
              <PatientCard card={selected.incident.patientCard} />
              <section className={styles.requestContext}>
                <span><Navigation /><small>예상 이동</small><strong>{selected.request.etaMinutes}분</strong></span>
                <span><MapPin /><small>도로 거리</small><strong>{selected.request.distanceKm.toFixed(1)}km</strong></span>
                <p><MapPin /> {selected.incident.sceneAddress}</p>
              </section>
            </>
          ) : <div className={styles.emptyReview}><Hospital /><h1>{inbox.length ? "환자 카드를 선택하세요" : "수용 요청 대기"}</h1><p>{inbox.length ? "좌측 요청을 선택하면 확정 환자정보와 ETA가 표시됩니다." : "새 요청이 도착하면 이 화면에 표시됩니다."}</p></div>}
        </section>

        <aside className={styles.decisionPanel}>
          {!selected ? <div className={styles.decisionEmpty}><Stethoscope /><strong>요청 대기</strong></div> : (
            <>
              <div className={styles.decisionHeading}><small>현재 회신</small><h2>{statusLabel[selected.request.status]}</h2></div>
              {selected.request.status === "VIEWED" || selected.request.status === "REQUESTED" ? <>
                <p className={styles.decisionHint}>환자 카드와 현재 병원 여력을 확인하고 YES 또는 NO로 회신합니다.</p>
                <button className={styles.yesButton} disabled={pending} onClick={() => setDecision("ACCEPTED")}><CheckCircle2 /> YES · 수용 가능</button>
                <button className={styles.noButton} disabled={pending} onClick={() => setDecision("DECLINED")}><X /> NO · 수용 곤란</button>
              </> : null}
              {selected.request.status === "ACCEPTED" && !isDestination ? <div className={styles.acceptedState}><CheckCircle2 /><strong>수용 가능 회신 완료</strong><p>구급대원의 최종 병원 선택을 기다립니다.</p></div> : null}
              {selected.request.status === "DECLINED" ? <div className={styles.declinedState}><X /><strong>수용 곤란 회신 완료</strong></div> : null}
              {selected.request.status === "CLOSED" && !isDestination ? <div className={styles.closedState}><Check /><strong>요청 종료</strong><p>구급대원이 다른 병원을 선택했습니다.</p></div> : null}
              {isDestination ? <div className={styles.incomingState}><Navigation /><strong>이송 병원으로 선택됨</strong><p>{selected.incident.stage === "arrived" ? "환자가 병원에 도착했습니다." : `환자 이동 예정 · ETA ${selected.request.etaMinutes}분`}</p></div> : null}
            </>
          )}
        </aside>
      </div>

      {decision && selected ? <div className={styles.modalBackdrop} onMouseDown={() => setDecision(null)}>
        <section className={styles.decisionModal} role="dialog" aria-modal="true" aria-label={decision === "ACCEPTED" ? "수용 가능 회신" : "수용 곤란 회신"} onMouseDown={(event) => event.stopPropagation()}>
          <button className={styles.modalClose} onClick={() => setDecision(null)} aria-label="닫기"><X /></button>
          {decision === "ACCEPTED" ? <><CheckCircle2 className={styles.modalYesIcon} /><h2>수용 가능으로 회신할까요?</h2><p>구급대원에게 YES가 전달되며, 최종 이송지는 구급대원이 선택합니다.</p></> : <><X className={styles.modalNoIcon} /><h2>수용 곤란으로 회신할까요?</h2><p>구급대원에게 NO가 바로 전달됩니다.</p></>}
          <button className={decision === "ACCEPTED" ? styles.modalYesButton : styles.modalNoButton} disabled={pending} onClick={() => void sendDecision()}>{decision === "ACCEPTED" ? <><Check /> YES 회신</> : <><X /> NO 회신</>}</button>
        </section>
      </div> : null}
    </main>
  );
}
