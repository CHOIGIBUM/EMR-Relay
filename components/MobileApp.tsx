"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Image from "next/image";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartPulse,
  Hospital,
  Info,
  LogOut,
  MapPin,
  MapPinned,
  Mic,
  Navigation,
  Phone,
  RadioTower,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  CARDIO_DEMO_HANDOFF,
  CARDIO_DEMO_PTT_UPDATES,
  CARDIO_DEMO_VITALS,
  REQUIRED_ASSESSMENT_PATHS_BY_STEP,
  STAGE_LABEL,
  operationalPttUpdateId,
  stageAtLeast,
  useDemo,
  type HospitalOption,
  type VitalValues,
} from "./DemoContext";
import type { CardioPttProposal, CardioPttUpdate } from "@/lib/cardioDemoData";
import KakaoRouteMap from "./KakaoRouteMap";
import {
  confirmVoiceProposal,
  createVoiceProposal,
  EMS_API_CONFIG,
  EmsApiError,
  getRouteReference,
  voiceProposalToPttUpdate,
} from "@/lib/emsApi";
import type { EmsApiTransport, RouteReferenceResponse, VoiceProposalResponse } from "@/lib/emsApiTypes";
import { currentAccessToken } from "@/lib/cognitoAuth";
import { OPERATIONAL_CONFIG } from "@/lib/operationalApi";
import { useTranscribePtt } from "@/hooks/useTranscribePtt";
import { useAuth } from "@/components/auth/AuthProvider";
import styles from "./MobileApp.module.css";

type Tab = "field" | "patient" | "hospital" | "handoff";
type VoiceMode = "listening" | "stopping" | "processing" | "review" | null;
type HospitalCandidateStatus = "available" | "locked" | "pending" | "info" | "accepted" | "declined" | "confirmed";
type AssessmentStep = 1 | 2 | 3;

type DirectAssessmentDraft = {
  airway: "" | "개방" | "확보 필요";
  breathing: "" | "자발호흡" | "호흡 이상";
  circulation: "" | "맥박 촉지" | "순환 불안정";
  chiefComplaint: string;
  onsetAt: string;
  painNrs: string;
  painQuality: string;
  painRadiation: string;
  associatedSymptoms: string;
  history: string;
  medication: string;
  allergy: string;
  interventions: string;
};

const emptyAssessmentDraft: DirectAssessmentDraft = {
  airway: "",
  breathing: "",
  circulation: "",
  chiefComplaint: "",
  onsetAt: "",
  painNrs: "",
  painQuality: "",
  painRadiation: "",
  associatedSymptoms: "",
  history: "",
  medication: "",
  allergy: "",
  interventions: "",
};

type VoiceResult = {
  update: CardioPttUpdate;
  response: VoiceProposalResponse;
  transport: EmsApiTransport;
  usedLocalFallback: boolean;
};

function defaultTab(stage: ReturnType<typeof useDemo>["state"]["stage"]): Tab {
  if (["coordination-requested", "hospital-requested", "info-requested", "info-sent", "declined", "accepted", "destination-confirmed"].includes(stage)) return "hospital";
  if (["hospital-arrived", "handoff-sent", "complete"].includes(stage)) return "handoff";
  if (stage === "summary-ready") return "patient";
  return "field";
}

const vitalFields: Array<{ key: keyof VitalValues; label: string; unit: string; placeholder: string }> = [
  { key: "bp", label: "혈압 BP", unit: "mmHg", placeholder: "예: 163/90" },
  { key: "pr", label: "맥박 PR", unit: "회/분", placeholder: "예: 91" },
  { key: "rr", label: "호흡수 RR", unit: "회/분", placeholder: "예: 23" },
  { key: "spo2", label: "SpO₂", unit: "%", placeholder: "예: 96" },
  { key: "temp", label: "체온", unit: "℃", placeholder: "예: 37.4" },
  { key: "glucose", label: "혈당", unit: "mg/dL", placeholder: "예: 116" },
];

const reassessmentFixture = CARDIO_DEMO_VITALS[1];
const reassessmentDefaults: VitalValues = {
  bp: `${reassessmentFixture.bloodPressure.systolic}/${reassessmentFixture.bloodPressure.diastolic}`,
  pr: String(reassessmentFixture.heartRate.value),
  rr: String(reassessmentFixture.respiratoryRate.value),
  spo2: String(reassessmentFixture.spo2.value),
  temp: String(reassessmentFixture.temperature.value),
  glucose: String(reassessmentFixture.bloodGlucose.value),
};

function createOperationalPttUpdates(caseId: string): CardioPttUpdate[] {
  const steps: Array<Pick<CardioPttUpdate, "sequence" | "topic" | "title">> = [
    { sequence: 1, topic: "initial_state", title: "최초 환자 상태" },
    { sequence: 2, topic: "focused_history", title: "발생시각·병력" },
    { sequence: 3, topic: "vitals_ecg_intervention", title: "활력징후·처치" },
    { sequence: 4, topic: "reassessment_change", title: "이송 중 재평가" },
  ];
  return steps.map((step) => ({
    ...step,
    id: operationalPttUpdateId(caseId, step.sequence),
    startedAt: "",
    endedAt: "",
    transcript: "",
    proposals: [],
    needsReview: true,
  }));
}

function reviewTone(status: CardioPttProposal["status"]): "confirmed" | "unknown" | "neutral" {
  if (status === "confirmed") return "confirmed";
  if (status === "unknown") return "unknown";
  return "neutral";
}

function StatusBadge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "teal" | "amber" | "green" | "red" }) {
  return <span className={styles.statusBadge} data-tone={tone}>{children}</span>;
}

function SourceTag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "confirmed" | "unknown" }) {
  return <span className={styles.sourceTag} data-tone={tone}>{children}</span>;
}

export default function MobileApp({ operational = false }: { operational?: boolean }) {
  const { state, dispatch, selectedHospital, transition, scenario: SCENARIO, hospitals: HOSPITALS, sync } = useDemo();
  const auth = useAuth();
  const { user } = auth;
  const [caseOpen, setCaseOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(() => defaultTab(state.stage));
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(null);
  const [voiceStopReady, setVoiceStopReady] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceConfirmError, setVoiceConfirmError] = useState<string | null>(null);
  const [isConfirmingVoice, setIsConfirmingVoice] = useState(false);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<string[]>([]);
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [spokenTranscript, setSpokenTranscript] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [callingHospitalId, setCallingHospitalId] = useState<string | null>(null);
  const [showReassessmentForm, setShowReassessmentForm] = useState(false);
  const [assessmentStep, setAssessmentStep] = useState<AssessmentStep>(1);
  const [assessmentDraft, setAssessmentDraft] = useState<DirectAssessmentDraft>(emptyAssessmentDraft);
  const [manualInputError, setManualInputError] = useState<string | null>(null);
  const [sceneRoute, setSceneRoute] = useState<RouteReferenceResponse | null>(null);
  const [transportRoute, setTransportRoute] = useState<RouteReferenceResponse | null>(null);
  const [reassessmentDraft, setReassessmentDraft] = useState<VitalValues>(() => operational
    ? { bp: "", pr: "", rr: "", spo2: "", temp: "", glucose: "" }
    : reassessmentDefaults);
  const [reassessmentTrend, setReassessmentTrend] = useState(() => operational ? "" : "흉통 및 식은땀 일부 호전");
  const toastRef = useRef<number | null>(null);
  const timeFor = (...titles: string[]) =>
    [...state.events].reverse().find((event) => titles.includes(event.title))?.time ?? "—";
  const voiceModeRef = useRef<VoiceMode>(null);
  const voiceRequestRef = useRef<AbortController | null>(null);
  const voiceRequestIdRef = useRef(0);
  const voiceStartPromiseRef = useRef<Promise<void> | null>(null);
  const voicePressOriginRef = useRef<VoiceMode>(null);
  const voiceLongPressRef = useRef(false);
  const voiceLongPressTimerRef = useRef<number | null>(null);
  const voiceStopArmTimerRef = useRef<number | null>(null);
  const suppressVoiceClickRef = useRef(false);
  const transcribe = useTranscribePtt();
  const scriptedPtt = !operational || OPERATIONAL_CONFIG.scriptedPtt;
  const callingHospital = HOSPITALS.find((hospital) => hospital.id === callingHospitalId) ?? null;
  const callerPhone = SCENARIO.callerPhone.replace(/[^\d+]/g, "");
  const callerPhoneAvailable = /^\+?\d{8,}$/.test(callerPhone);
  const pttUpdates = useMemo(
    () => operational ? createOperationalPttUpdates(SCENARIO.sourceCaseId) : [...CARDIO_DEMO_PTT_UPDATES],
    [operational, SCENARIO.sourceCaseId],
  );
  const nextPttUpdate = useMemo(() => {
    const pending = pttUpdates.filter((update) => !state.confirmedPttIds.includes(update.id));
    if (state.stage === "transporting") return pending.find((update) => update.sequence === 4) ?? null;
    return pending.find((update) => update.sequence <= 3) ?? null;
  }, [pttUpdates, state.confirmedPttIds, state.stage]);
  const completedAssessmentSteps = useMemo(() => new Set(
    ([1, 2, 3] as const).filter((sequence) => state.confirmedPttIds.some((id) => id.endsWith(`-U0${sequence}`))),
  ), [state.confirmedPttIds]);
  const transcriptSteps = useMemo(() => {
    const transcript = nextPttUpdate?.transcript ?? "확인할 다음 음성 입력이 없습니다.";
    const parts = transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.length ? parts.map((_, index) => parts.slice(0, index + 1).join(" ")) : [transcript];
  }, [nextPttUpdate]);

  const notify = (message: string) => {
    setToast(message);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => () => {
    if (toastRef.current) window.clearTimeout(toastRef.current);
    if (voiceLongPressTimerRef.current) window.clearTimeout(voiceLongPressTimerRef.current);
    if (voiceStopArmTimerRef.current) window.clearTimeout(voiceStopArmTimerRef.current);
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
  }, []);

  useEffect(() => {
    const origin = SCENARIO.unitBase;
    const destination = SCENARIO.sceneLocation;
    if (!origin || !destination) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const accessToken = operational ? await currentAccessToken() : null;
        const result = await getRouteReference({
          caseId: SCENARIO.sourceCaseId,
          origin,
          destination,
        }, {
          signal: controller.signal,
          accessToken: accessToken ?? undefined,
          forceLocal: !operational,
        });
        if (!cancelled) setSceneRoute(result.data);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) setSceneRoute(null);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    operational,
    SCENARIO.sourceCaseId,
    SCENARIO.unitBase,
    SCENARIO.sceneLocation,
  ]);

  useEffect(() => {
    const destinationReady = ["destination-confirmed", "transporting", "hospital-arrived", "handoff-sent", "complete"].includes(state.stage);
    if (!destinationReady || SCENARIO.latitude === undefined || SCENARIO.longitude === undefined
      || selectedHospital?.latitude === undefined || selectedHospital.longitude === undefined) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const accessToken = operational ? await currentAccessToken() : null;
        const result = await getRouteReference({
          caseId: SCENARIO.sourceCaseId,
          origin: { latitude: SCENARIO.latitude!, longitude: SCENARIO.longitude! },
          destination: { latitude: selectedHospital.latitude!, longitude: selectedHospital.longitude! },
        }, {
          signal: controller.signal,
          accessToken: accessToken ?? undefined,
          forceLocal: !operational,
        });
        if (!cancelled) setTransportRoute(result.data);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) setTransportRoute(null);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    operational,
    SCENARIO.sourceCaseId,
    SCENARIO.latitude,
    SCENARIO.longitude,
    selectedHospital?.id,
    selectedHospital?.latitude,
    selectedHospital?.longitude,
    state.stage,
  ]);

  useEffect(() => {
    if (voiceMode !== "listening" || !scriptedPtt) return;
    const timer = window.setInterval(() => {
      setTranscriptIndex((current) => Math.min(current + 1, transcriptSteps.length - 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [voiceMode, scriptedPtt, transcriptSteps.length]);

  const assessmentReady = useMemo(
    () => state.vitalsConfirmed && state.avpu !== "미확인" && pttUpdates.slice(0, 3).every((update) => state.confirmedPttIds.includes(update.id)),
    [pttUpdates, state.vitalsConfirmed, state.avpu, state.confirmedPttIds],
  );

  const setVoicePhase = (next: VoiceMode) => {
    voiceModeRef.current = next;
    setVoiceMode(next);
  };

  const cancelVoice = () => {
    if (voiceLongPressTimerRef.current) window.clearTimeout(voiceLongPressTimerRef.current);
    if (voiceStopArmTimerRef.current) window.clearTimeout(voiceStopArmTimerRef.current);
    voiceLongPressTimerRef.current = null;
    voiceStopArmTimerRef.current = null;
    voiceLongPressRef.current = false;
    voicePressOriginRef.current = null;
    setVoiceStopReady(false);
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
    voiceStartPromiseRef.current = null;
    transcribe.cancel();
    setVoiceError(null);
    setVoiceConfirmError(null);
    setIsConfirmingVoice(false);
    setVoicePhase(null);
  };

  const beginVoice = () => {
    if (voiceModeRef.current !== null || !nextPttUpdate) return;
    voiceRequestIdRef.current += 1;
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = null;
    setVoiceError(null);
    setVoiceConfirmError(null);
    setIsConfirmingVoice(false);
    setVoiceResult(null);
    setAcceptedProposalIds([]);
    setSpokenTranscript("");
    setTranscriptIndex(0);
    if (voiceStopArmTimerRef.current) window.clearTimeout(voiceStopArmTimerRef.current);
    setVoiceStopReady(false);
    setVoicePhase("listening");
    // The full-screen listening layer can appear beneath the same finger that
    // started the gesture. Arm its stop button only after that opening gesture
    // has safely ended, preventing an accidental immediate submission.
    voiceStopArmTimerRef.current = window.setTimeout(() => {
      voiceStopArmTimerRef.current = null;
      setVoiceStopReady(true);
    }, 700);
    if (!scriptedPtt) {
      voiceStartPromiseRef.current = transcribe.start(SCENARIO.sourceCaseId).catch((error: unknown) => {
        setVoiceError(error instanceof Error ? error.message : "음성 입력을 시작하지 못했습니다.");
        setVoicePhase("review");
        throw error;
      });
    }
  };

  const finishVoice = () => {
    const pendingUpdate = nextPttUpdate;
    if (voiceModeRef.current !== "listening" || !pendingUpdate) return;

    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;
    const controller = new AbortController();
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = controller;
    if (voiceStopArmTimerRef.current) window.clearTimeout(voiceStopArmTimerRef.current);
    voiceStopArmTimerRef.current = null;
    setVoiceStopReady(false);
    setVoicePhase("stopping");

    void (async () => {
      try {
        let transcript: string = pendingUpdate.transcript;
        if (!scriptedPtt) {
          await voiceStartPromiseRef.current;
          transcript = await transcribe.stop();
          if (!transcript.trim()) throw new Error("인식된 문장이 없습니다. 마이크 가까이에서 다시 말씀해 주세요.");
        }
        setSpokenTranscript(transcript);
        setVoicePhase("processing");
        const accessToken = await currentAccessToken();
        const result = await createVoiceProposal({
          caseId: SCENARIO.sourceCaseId,
          updateId: pendingUpdate.id,
          transcript,
          locale: "ko-KR",
        }, {
          signal: controller.signal,
          accessToken: accessToken ?? undefined,
          forceLocal: !operational,
        });
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        await sync.refresh();
        const update = voiceProposalToPttUpdate(pendingUpdate, result.data);
        setVoiceResult({
          update,
          response: result.data,
          transport: result.transport,
          usedLocalFallback: result.usedLocalFallback,
        });
        // Nothing is selected by default. A user gesture is required for every
        // field before CONFIRM_PTT can write to the confirmed state.
        setAcceptedProposalIds([]);
        setVoiceError(null);
        setVoicePhase("review");
      } catch (error) {
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        setVoiceResult(null);
        setAcceptedProposalIds([]);
        setVoiceError(error instanceof Error ? error.message : "음성 변경안을 준비하지 못했습니다. 다시 시도하거나 직접 입력하세요.");
        setVoicePhase("review");
      } finally {
        voiceStartPromiseRef.current = null;
        if (voiceRequestIdRef.current === requestId) voiceRequestRef.current = null;
      }
    })();
  };

  const updateAssessmentDraft = <K extends keyof DirectAssessmentDraft>(key: K, value: DirectAssessmentDraft[K]) => {
    setAssessmentDraft((current) => ({ ...current, [key]: value }));
    setManualInputError(null);
  };

  const buildManualTranscript = (step: AssessmentStep) => {
    if (step === 1) {
      if (!assessmentDraft.airway || !assessmentDraft.breathing || !assessmentDraft.circulation
        || !assessmentDraft.chiefComplaint.trim() || state.avpu === "미확인") {
        return { error: "ABC, AVPU, 주호소를 모두 입력하세요." } as const;
      }
      return {
        transcript: `환자 접촉 후 초기 평가입니다. 기도 ${assessmentDraft.airway}, 호흡 ${assessmentDraft.breathing}, 순환 ${assessmentDraft.circulation}입니다. 의식수준은 AVPU ${state.avpu}입니다. 주호소는 ${assessmentDraft.chiefComplaint.trim()}입니다.`,
      } as const;
    }
    if (step === 2) {
      if (!assessmentDraft.onsetAt || !assessmentDraft.painNrs || !assessmentDraft.painQuality
        || !assessmentDraft.painRadiation || !assessmentDraft.associatedSymptoms.trim()) {
        return { error: "발생시각, NRS, 흉통 양상, 방사통, 동반증상을 입력하세요." } as const;
      }
      return {
        transcript: `증상 발생시각은 ${assessmentDraft.onsetAt}입니다. 흉통은 NRS ${assessmentDraft.painNrs}, ${assessmentDraft.painQuality} 양상이며 방사통은 ${assessmentDraft.painRadiation}입니다. 동반증상은 ${assessmentDraft.associatedSymptoms.trim()}입니다. 과거력은 ${assessmentDraft.history.trim() || "미확인"}, 복용약은 ${assessmentDraft.medication.trim() || "미확인"}, 알레르기는 ${assessmentDraft.allergy.trim() || "미확인"}입니다.`,
      } as const;
    }
    if (!Object.values(state.vitals).every((value) => value.trim())) {
      return { error: "BP, PR, RR, SpO₂, 체온, 혈당을 모두 입력하세요." } as const;
    }
    return {
      transcript: `최초 활력징후는 혈압 ${state.vitals.bp} mmHg, 맥박 ${state.vitals.pr}회/분, 호흡수 ${state.vitals.rr}회/분, 산소포화도 ${state.vitals.spo2}%, 체온 ${state.vitals.temp}도, 혈당 ${state.vitals.glucose} mg/dL입니다. 시행 처치는 ${assessmentDraft.interventions.trim() || "없음"}입니다.`,
    } as const;
  };

  const submitManualAssessment = () => {
    const pendingUpdate = nextPttUpdate;
    if (!pendingUpdate || pendingUpdate.sequence !== assessmentStep) {
      setManualInputError("앞 단계의 확인을 먼저 완료하세요.");
      return;
    }
    const manual = buildManualTranscript(assessmentStep);
    if ("error" in manual && manual.error) {
      setManualInputError(manual.error);
      return;
    }

    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;
    const controller = new AbortController();
    voiceRequestRef.current?.abort();
    voiceRequestRef.current = controller;
    setManualInputError(null);
    setVoiceError(null);
    setVoiceConfirmError(null);
    setVoiceResult(null);
    setAcceptedProposalIds([]);
    setSpokenTranscript(manual.transcript);
    setVoicePhase("processing");

    void (async () => {
      try {
        const accessToken = await currentAccessToken();
        const result = await createVoiceProposal({
          caseId: SCENARIO.sourceCaseId,
          updateId: pendingUpdate.id,
          transcript: manual.transcript,
          locale: "ko-KR",
        }, {
          signal: controller.signal,
          accessToken: accessToken ?? undefined,
          forceLocal: !operational,
        });
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        await sync.refresh();
        const update = voiceProposalToPttUpdate(pendingUpdate, result.data);
        setVoiceResult({
          update,
          response: result.data,
          transport: result.transport,
          usedLocalFallback: result.usedLocalFallback,
        });
        setVoicePhase("review");
      } catch (error) {
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        setVoiceError(error instanceof Error ? error.message : "입력 내용을 정리하지 못했습니다.");
        setVoicePhase("review");
      } finally {
        if (voiceRequestIdRef.current === requestId) voiceRequestRef.current = null;
      }
    })();
  };

  const applyReviewedVoice = async () => {
    const reviewedResult = voiceResult;
    if (!reviewedResult || !acceptedProposalIds.length || isConfirmingVoice) return;

    const acceptedIds = new Set(acceptedProposalIds);
    const allIds = reviewedResult.update.proposals.map((proposal) => proposal.id);
    setVoiceConfirmError(null);

    if (reviewedResult.transport === "remote") {
      const proposalSetId = reviewedResult.response.proposal_set_id;
      const expectedVersion = reviewedResult.response.base_version;
      if (!proposalSetId || expectedVersion === null) {
        setVoiceConfirmError("서버 응답에 변경안 번호 또는 기준 버전이 없어 확정하지 않았습니다. 다시 입력해 주세요.");
        return;
      }
      const reviewerId = user?.subject || EMS_API_CONFIG.reviewerId;
      if (!reviewerId) {
        setVoiceConfirmError("확인자 정보가 설정되지 않아 확정하지 않았습니다. 로그인 정보 또는 환경 설정을 확인해 주세요.");
        return;
      }

      const requestId = voiceRequestIdRef.current + 1;
      voiceRequestIdRef.current = requestId;
      const controller = new AbortController();
      voiceRequestRef.current?.abort();
      voiceRequestRef.current = controller;
      setIsConfirmingVoice(true);

      try {
        const accessToken = await currentAccessToken();
        await confirmVoiceProposal({
          caseId: reviewedResult.response.case_id,
          proposalSetId,
          expectedVersion,
          reviewedBy: reviewerId,
          decisions: reviewedResult.response.proposed_updates.map((proposal) => acceptedIds.has(proposal.proposal_id)
            ? { changeId: proposal.proposal_id, action: "accept" as const, value: proposal.value }
            : { changeId: proposal.proposal_id, action: "reject" as const }),
        }, { signal: controller.signal, accessToken: accessToken ?? undefined });
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
      } catch (error) {
        if (controller.signal.aborted || voiceRequestIdRef.current !== requestId) return;
        setVoiceConfirmError(error instanceof EmsApiError
          ? error.message
          : "확정 저장에 실패했습니다. 기존 환자정보는 변경되지 않았습니다.");
        return;
      } finally {
        if (voiceRequestIdRef.current === requestId) {
          voiceRequestRef.current = null;
          setIsConfirmingVoice(false);
        }
      }
    }

    const reviewedSequence = reviewedResult.update.sequence;
    const confirmedPathsAfterReview = new Set([
      ...Object.values(state.confirmedFacts).map((fact) => fact.fieldPath).filter((path): path is string => Boolean(path)),
      ...reviewedResult.update.proposals
        .filter((proposal) => acceptedIds.has(proposal.id))
        .map((proposal) => proposal.fieldPath)
        .filter((path): path is string => Boolean(path)),
    ]);
    const reviewedStep = reviewedSequence === 1 || reviewedSequence === 2 || reviewedSequence === 3
      ? reviewedSequence
      : null;
    const reviewedStepComplete = reviewedStep !== null
      && REQUIRED_ASSESSMENT_PATHS_BY_STEP[reviewedStep].every((path) => confirmedPathsAfterReview.has(path));

    dispatch({
      type: "CONFIRM_PTT",
      updateId: reviewedResult.update.id,
      acceptedProposalIds,
      rejectedProposalIds: allIds.filter((id) => !acceptedIds.has(id)),
      reviewedProposals: reviewedResult.update.proposals,
    });
    if (reviewedStepComplete && reviewedSequence < 3) setAssessmentStep((reviewedSequence + 1) as AssessmentStep);
    setVoicePhase(null);
    setVoiceResult(null);
    setVoiceConfirmError(null);
    notify(`${acceptedProposalIds.length}개 항목을 확인값으로 반영했습니다.`);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (voiceLongPressTimerRef.current) window.clearTimeout(voiceLongPressTimerRef.current);
    voicePressOriginRef.current = voiceModeRef.current;
    voiceLongPressRef.current = false;
    suppressVoiceClickRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (voiceModeRef.current === null) {
      beginVoice();
      voiceLongPressTimerRef.current = window.setTimeout(() => {
        voiceLongPressRef.current = true;
      }, 550);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const startedWhileListening = voicePressOriginRef.current === "listening";
    const wasLongPress = voiceLongPressRef.current;
    if (voiceLongPressTimerRef.current) window.clearTimeout(voiceLongPressTimerRef.current);
    voiceLongPressTimerRef.current = null;
    voiceLongPressRef.current = false;
    voicePressOriginRef.current = null;
    // A short first tap starts hands-free recording. A long press behaves like
    // conventional PTT and stops when the user releases their finger.
    if (startedWhileListening || wasLongPress) finishVoice();
  };

  const handlePointerCancel = () => {
    if (voiceLongPressTimerRef.current) window.clearTimeout(voiceLongPressTimerRef.current);
    voiceLongPressTimerRef.current = null;
    voiceLongPressRef.current = false;
    voicePressOriginRef.current = null;
    // Mobile browsers can emit pointercancel when the full-screen listening
    // layer appears. Keep recording in that case; the prominent stop control
    // remains available and prevents an accidental zero-length submission.
  };

  const handleVoiceClick = () => {
    // Every pointer gesture emits a trailing click. Consume that click so a
    // short first tap does not immediately stop the recording it just began.
    // Keyboard and assistive clicks do not pass through handlePointerDown and
    // therefore retain the same tap-to-start/tap-to-stop contract.
    if (suppressVoiceClickRef.current) {
      suppressVoiceClickRef.current = false;
      return;
    }
    suppressVoiceClickRef.current = false;
    if (voiceModeRef.current === "listening") finishVoice();
    else if (voiceModeRef.current === null) beginVoice();
  };

  const returnToCaseList = () => {
    if (voiceModeRef.current) cancelVoice();
    setCallingHospitalId(null);
    setShowReassessmentForm(false);
    setTab(defaultTab(state.stage));
    setCaseOpen(false);
  };

  const phoneHeader = (
    <header className={styles.appHeader}>
      <button className={styles.brandHome} type="button" onClick={returnToCaseList} aria-label="출동 목록으로 이동">
        <span className={styles.brandMark}><Image src="/ems-relay-icon.png" width={40} height={40} alt="EMS Relay" priority /></span>
        <span className={styles.brandText}><strong>EMS Relay</strong><span>출동 목록</span></span>
      </button>
      <div className={styles.connection} data-state={sync.connection} role="status" aria-live="polite"><i /> {sync.pending ? "반영 중" : sync.mode === "remote" ? "실시간 연결" : "로컬"}</div>
      <button className={styles.headerSignOut} type="button" onClick={auth.signOut} aria-label="로그아웃"><LogOut size={18} /></button>
    </header>
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
          <div><span>{state.stage === "assigned" ? "현재 배정" : "진행 중"}</span><h1>출동 사건 1건</h1></div>
          <button aria-label="출동 목록 새로고침" disabled={sync.pending} onClick={() => void sync.refresh()}><RefreshCw size={18} /></button>
        </div>
        <button className={styles.caseCard} onClick={() => setCaseOpen(true)}>
          <div className={styles.caseTop}>
            <span>{SCENARIO.id}</span>
            <time><Clock3 size={14} /> 지령 {timeFor("구급대 출동 지령")}</time>
          </div>
          <strong>{SCENARIO.reportedComplaint}</strong>
          <p>{SCENARIO.reportedPatient}</p>
          <div className={styles.caseLocation}><MapPin size={15} /> {SCENARIO.locationShort}</div>
          <div className={styles.caseFooter}><StatusBadge tone={state.stage === "complete" ? "green" : state.stage === "assigned" ? "amber" : "teal"}>{STAGE_LABEL[state.stage]}</StatusBadge><span>{SCENARIO.unit}</span><ChevronRight size={19} /></div>
        </button>
        <div className={styles.emptyList}><ClipboardCheck size={21} /><span>다른 배정 사건이 없습니다.</span></div>
      </main>
    </>
  );

  const renderDispatch = () => {
    const enroute = state.stage === "enroute";
    const sceneEta = sceneRoute?.eta_minutes ?? SCENARIO.routeToScene?.etaMinutes ?? null;
    const sceneDistance = sceneRoute?.distance_km ?? SCENARIO.routeToScene?.distanceKm ?? null;
    const sceneRouteIsLive = sceneRoute?.is_live ?? SCENARIO.routeToScene?.isLive ?? false;
    const sceneRouteLabel = sceneEta === null || sceneDistance === null
      ? "경로 미확인"
      : sceneRouteIsLive ? "카카오 실시간" : "카카오 저장 경로";
    return (
      <>
        {contextHeader(enroute ? "현장 이동" : "신고 내용", state.stage === "assigned" ? () => setCaseOpen(false) : undefined)}
        <main className={styles.phoneScroll}>
          <section className={styles.reportCard}>
            <div className={styles.cardEyebrow}><Phone size={15} /> 119 신고 내용</div>
            <h1>{SCENARIO.reportedPatient}</h1>
            <p>{SCENARIO.reportedComplaint}</p>
            <dl>
              <div><dt>신고자</dt><dd>{SCENARIO.caller}</dd></div>
              <div><dt>신고시각</dt><dd>{timeFor("119 신고 접수")}</dd></div>
            </dl>
          </section>

          <section className={styles.dispatchRouteCard}>
            <div className={styles.dispatchMapViewport}>
              {SCENARIO.unitBase && SCENARIO.sceneLocation ? (
                <KakaoRouteMap
                  origin={SCENARIO.unitBase}
                  originName={SCENARIO.unitBase.name}
                  destination={SCENARIO.sceneLocation}
                  destinationName={SCENARIO.sceneLocation.name}
                  path={sceneRoute?.path}
                />
              ) : (
                <div className={styles.dispatchMapFallback}><MapPinned size={24} /><strong>현장 좌표 확인 필요</strong></div>
              )}
            </div>
            <div className={styles.dispatchRouteSummary}>
              <div>
                <span>{SCENARIO.unitBase?.name ?? SCENARIO.unit} → {SCENARIO.locationName ?? "신고 현장"}</span>
                <strong>{sceneEta === null ? "조회 전" : `${sceneEta}분`}</strong>
                <small>{sceneDistance === null ? "거리 미확인" : `${sceneDistance.toFixed(1)} km`} · {sceneRouteLabel}</small>
              </div>
              <Navigation size={20} />
            </div>
          </section>

          <section className={styles.locationCard}>
            <div><MapPin size={18} /><strong>{SCENARIO.location}</strong></div>
            <p>{SCENARIO.access}</p>
            {callerPhoneAvailable
              ? <a href={`tel:${callerPhone}`}><Phone size={16} /> 신고자 전화</a>
              : <span className={styles.phoneUnavailable}><Phone size={16} /> 신고자 전화번호 미확인</span>}
          </section>

          <div className={styles.timeStrip}>
            <div data-state="done"><span><Check size={13} /></span><strong>신고 접수</strong><time>{timeFor("119 신고 접수")}</time></div>
            <i />
            <div data-state={enroute ? "done" : "current"}><span>{enroute ? <Check size={13} /> : "2"}</span><strong>출동 시작</strong><time>{enroute ? timeFor("출동 시작") : "확인 전"}</time></div>
            <i />
            <div data-state={enroute ? "current" : "waiting"}><span>3</span><strong>현장 도착</strong><time>도착 후 확인</time></div>
          </div>
        </main>
        <div className={styles.stickyAction}>
          {!enroute ? (
            <button className={styles.primaryAction} onClick={() => transition("enroute", "구급대원", "출동 시작", `${SCENARIO.unit} · 사용자 확인 시각 기록`, "teal")}>
              <Ambulance size={21} /> 출동 시작
            </button>
          ) : (
            <button className={styles.primaryAction} onClick={() => transition("scene-arrived", "구급대원", "현장 도착", `${SCENARIO.location} · GPS 확인`, "teal")}>
              <MapPin size={21} /> 현장 도착
            </button>
          )}
        </div>
      </>
    );
  };

  const renderArrival = () => (
    <>
      {contextHeader("현장 도착")}
      <main className={styles.phoneScroll}>
        <section className={styles.arrivalRecord}>
          <CheckCircle2 size={22} />
          <div><strong>현장 도착</strong><span>{timeFor("현장 도착")}</span><small>{SCENARIO.location}</small></div>
        </section>
      </main>
      <div className={styles.stickyAction}>
        <button className={styles.primaryAction} onClick={() => transition("patient-contact", "구급대원", "환자 접촉", `${SCENARIO.patient} · 현장 직접 확인`, "teal")}>
          <UserRound size={21} /> 환자 접촉
        </button>
      </div>
    </>
  );

  const renderFieldAssessment = () => {
    const currentSequence = nextPttUpdate && nextPttUpdate.sequence <= 3 ? nextPttUpdate.sequence : null;
    const stepComplete = completedAssessmentSteps.has(assessmentStep);
    const canSubmitStep = currentSequence === assessmentStep;
    return (
      <>
        <section className={styles.assessmentHeader}>
          <div><strong>환자 평가</strong><span>접촉 {timeFor("환자 접촉")}</span></div>
          <b>{completedAssessmentSteps.size}/3 완료</b>
        </section>

        <nav className={styles.assessmentSteps} aria-label="환자 평가 입력 단계">
          {([
            [1, "초기 상태", "ABC · AVPU · 주호소"],
            [2, "흉통 문진", "발생시각 · NRS · 동반증상"],
            [3, "활력·처치", "BP · PR · RR · SpO₂"],
          ] as const).map(([step, title, detail]) => (
            <button
              key={step}
              type="button"
              data-active={assessmentStep === step}
              data-complete={completedAssessmentSteps.has(step)}
              disabled={!completedAssessmentSteps.has(step) && currentSequence !== step}
              onClick={() => setAssessmentStep(step)}
            >
              <span>{completedAssessmentSteps.has(step) ? <Check size={15} /> : step}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </nav>

        <section className={styles.assessmentForm}>
          <div className={styles.sectionTitle}>
            <div><HeartPulse size={19} /><strong>{assessmentStep === 1 ? "1. 초기 상태" : assessmentStep === 2 ? "2. 흉통 문진" : "3. 활력징후·처치"}</strong></div>
            {stepComplete && <span className={styles.completedLabel}><Check size={14} /> 확인됨</span>}
          </div>

          {assessmentStep === 1 && (
            <>
              <fieldset className={styles.fieldGroup}>
                <legend>ABC</legend>
                <div className={styles.abcGrid}>
                  {([
                    ["airway", "A · 기도", ["개방", "확보 필요"]],
                    ["breathing", "B · 호흡", ["자발호흡", "호흡 이상"]],
                    ["circulation", "C · 순환", ["맥박 촉지", "순환 불안정"]],
                  ] as const).map(([key, label, values]) => (
                    <div key={key}><strong>{label}</strong><span>{values.map((value) => <button key={value} type="button" aria-pressed={assessmentDraft[key] === value} onClick={() => updateAssessmentDraft(key, value)}>{value}</button>)}</span></div>
                  ))}
                </div>
              </fieldset>
              <fieldset className={styles.fieldGroup}>
                <legend>의식수준 AVPU</legend>
                <div className={styles.avpuGrid}>{(["A", "V", "P", "U"] as const).map((value) => <button type="button" aria-pressed={state.avpu === value} onClick={() => dispatch({ type: "SET_AVPU", value })} key={value}>{value}</button>)}</div>
              </fieldset>
              <label className={styles.textField}><span>주호소</span><input value={assessmentDraft.chiefComplaint} onChange={(event) => updateAssessmentDraft("chiefComplaint", event.target.value)} placeholder="예: 가슴이 쥐어짜듯 아픔" /></label>
            </>
          )}

          {assessmentStep === 2 && (
            <div className={styles.clinicalGrid}>
              <label className={styles.textField}><span>증상 발생시각</span><input type="time" value={assessmentDraft.onsetAt} onChange={(event) => updateAssessmentDraft("onsetAt", event.target.value)} /></label>
              <label className={styles.textField}><span>흉통 NRS</span><select value={assessmentDraft.painNrs} onChange={(event) => updateAssessmentDraft("painNrs", event.target.value)}><option value="">선택</option>{Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className={styles.textField}><span>흉통 양상</span><select value={assessmentDraft.painQuality} onChange={(event) => updateAssessmentDraft("painQuality", event.target.value)}><option value="">선택</option><option>쥐어짜는</option><option>압박하는</option><option>찌르는</option><option>타는 듯한</option><option>기타</option></select></label>
              <label className={styles.textField}><span>방사통</span><select value={assessmentDraft.painRadiation} onChange={(event) => updateAssessmentDraft("painRadiation", event.target.value)}><option value="">선택</option><option>없음</option><option>왼팔</option><option>오른팔</option><option>양팔</option><option>턱·목</option><option>등</option></select></label>
              <label className={`${styles.textField} ${styles.wideField}`}><span>동반증상</span><input value={assessmentDraft.associatedSymptoms} onChange={(event) => updateAssessmentDraft("associatedSymptoms", event.target.value)} placeholder="예: 식은땀, 호흡곤란, 오심" /></label>
              <label className={`${styles.textField} ${styles.wideField}`}><span>과거력</span><input value={assessmentDraft.history} onChange={(event) => updateAssessmentDraft("history", event.target.value)} placeholder="없거나 미확인이면 비워두기" /></label>
              <label className={styles.textField}><span>복용약</span><input value={assessmentDraft.medication} onChange={(event) => updateAssessmentDraft("medication", event.target.value)} placeholder="약명 또는 미확인" /></label>
              <label className={styles.textField}><span>알레르기</span><input value={assessmentDraft.allergy} onChange={(event) => updateAssessmentDraft("allergy", event.target.value)} placeholder="없음 또는 미확인" /></label>
            </div>
          )}

          {assessmentStep === 3 && (
            <>
              <div className={styles.vitalGrid}>
                {vitalFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <div><input inputMode="decimal" value={state.vitals[field.key]} placeholder={field.placeholder} onChange={(event) => dispatch({ type: "SET_VITAL", key: field.key, value: event.target.value })} /><small>{field.unit}</small></div>
                  </label>
                ))}
              </div>
              <label className={`${styles.textField} ${styles.treatmentField}`}><span>시행 처치</span><input value={assessmentDraft.interventions} onChange={(event) => updateAssessmentDraft("interventions", event.target.value)} placeholder="예: 심전도 감시, 정맥로 확보" /></label>
            </>
          )}

          {!stepComplete && (
            <div className={styles.assessmentActions}>
              <button type="button" className={styles.manualConfirm} disabled={!canSubmitStep || voiceMode !== null} onClick={submitManualAssessment}><ClipboardCheck size={18} /> 직접 입력 정리</button>
              <button
                type="button"
                className={styles.inlinePtt}
                disabled={!canSubmitStep || voiceMode !== null}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onClick={handleVoiceClick}
              ><Mic size={19} /> 말로 입력</button>
            </div>
          )}
          {manualInputError && <p className={styles.inputError} role="alert">{manualInputError}</p>}
        </section>

        <button className={styles.fullAction} disabled={!assessmentReady} onClick={() => { dispatch({ type: "CONFIRM_ASSESSMENT" }); setTab("patient"); }}>
          <ClipboardCheck size={19} /> 환자 확인본 생성
        </button>
        {!assessmentReady && <p className={styles.requirement}>초기 상태, 흉통 문진, 활력·처치 3단계를 확인하세요.</p>}
      </>
    );
  };

  const renderPatientSummary = () => (
    <>
      <section className={styles.summaryHero}>
        <div className={styles.cardEyebrow}><UserRound size={15} /> 환자 확인본</div>
        <h1>{SCENARIO.patient}</h1>
        <p>{SCENARIO.chiefComplaint}</p>
        <div className={styles.summaryAssessment}><span>병원 전 평가</span><strong>{SCENARIO.impression}</strong><small>AVPU {state.avpu}</small></div>
      </section>

      <section className={styles.compactVitals}>
        <div><span>BP</span><strong>{state.vitals.bp || "—"}</strong><small>mmHg</small></div>
        <div><span>PR</span><strong>{state.vitals.pr || "—"}</strong><small>회/분</small></div>
        <div><span>RR</span><strong>{state.vitals.rr || "—"}</strong><small>회/분</small></div>
        <div><span>SpO₂</span><strong>{state.vitals.spo2 || "—"}</strong><small>%</small></div>
        <div><span>혈당</span><strong>{state.vitals.glucose || "—"}</strong><small>mg/dL</small></div>
        <div><span>AVPU</span><strong>{state.avpu}</strong><small>{timeFor("최초 활력징후 확인", "심혈관 중점평가 확인")}</small></div>
      </section>

      <section className={styles.detailList}>
        <div><span>ABC</span><strong>A {SCENARIO.primarySurvey.airway} · B {SCENARIO.primarySurvey.breathing} · C {SCENARIO.primarySurvey.circulation}</strong><small>환자 접촉 후 확인</small></div>
        <div><span>발생시각</span><strong>{SCENARIO.onset}</strong><small>{SCENARIO.onsetSource}</small></div>
        <div><span>증상</span><strong>{SCENARIO.symptoms.join(" · ") || "미확인"}</strong><small>환자 진술·현장 관찰</small></div>
        <div><span>흉통</span><strong>NRS {SCENARIO.pain.severityNrs} · {SCENARIO.pain.region} · {SCENARIO.pain.radiation} 방사</strong><small>구급대원 확인</small></div>
        <div><span>병력</span><strong>{SCENARIO.history.join(" · ") || "미확인"}</strong><small>환자 진술 · 추가 확인 필요</small></div>
        <div data-tone="unknown"><span>복용약</span><strong>{SCENARIO.medication}</strong><small>진술 기반 · 약제 확인 필요</small></div>
        <div data-tone="unknown"><span>미상 항목</span><strong>{SCENARIO.unresolvedItems.join(" · ") || "없음"}</strong><small>임의로 채우지 않고 그대로 전달</small></div>
      </section>

      {state.stage === "summary-ready" && (
        <button className={styles.fullAction} onClick={() => setTab("hospital")}>
          <Hospital size={19} /> 병원 후보 확인
        </button>
      )}
    </>
  );

  const renderHospitalStatus = () => {
    const activeRequest = ["hospital-requested", "info-requested", "info-sent"].includes(state.stage);
    const canStartRequest = ["summary-ready", "coordination-requested", "declined"].includes(state.stage);

    const requestEventFor = (hospital: HospitalOption) => [...state.events]
      .reverse()
      .find((event) => event.title === "병원 수용 문의" && event.detail.includes(hospital.name));

    const declineReasonFor = (hospital: HospitalOption) => {
      const event = [...state.events]
        .reverse()
        .find((item) => item.title === "수용 곤란 회신" && item.detail.includes(hospital.name));
      if (!event) return "병원 회신 사유를 확인해 주세요.";
      return event.detail.split("·").slice(1).join("·").trim() || "병원 회신 사유를 확인해 주세요.";
    };

    const candidateStatus = (hospital: HospitalOption): HospitalCandidateStatus => {
      const isSelected = state.selectedHospitalId === hospital.id;
      if (isSelected && state.destinationConfirmed) return "confirmed";
      if (state.declinedHospitalIds.includes(hospital.id)) return "declined";
      if (isSelected && state.stage === "accepted") return "accepted";
      if (isSelected && state.stage === "info-requested") return "info";
      if (isSelected && ["hospital-requested", "info-sent"].includes(state.stage)) return "pending";
      if (activeRequest || state.stage === "accepted" || state.destinationConfirmed) return "locked";
      return "available";
    };

    const status = (() => {
      if (state.stage === "summary-ready") return { icon: Hospital, title: "문의할 병원 한 곳을 선택하세요", detail: "기관정보와 예상 이동시간을 참고해 구급대원이 직접 문의합니다.", tone: "teal" as const };
      if (state.stage === "coordination-requested") return { icon: RadioTower, title: "상황실과 지원 요청을 공유했습니다", detail: "병원 선택과 문의는 현장 구급대원이 계속 진행합니다.", tone: "amber" as const };
      if (state.stage === "hospital-requested") return { icon: Hospital, title: `${selectedHospital?.name ?? "병원"} 회신 대기`, detail: "현재 문의가 끝난 뒤에만 다음 병원에 문의할 수 있습니다.", tone: "amber" as const };
      if (state.stage === "info-requested") return { icon: FileText, title: "병원이 추가정보를 요청했습니다", detail: state.requestedInfo.join(" · "), tone: "amber" as const };
      if (state.stage === "info-sent") return { icon: Send, title: "추가정보를 전달했습니다", detail: "병원 회신을 기다리는 동안 전화로 확인할 수 있습니다.", tone: "teal" as const };
      if (state.stage === "declined") return { icon: RefreshCw, title: "수용 곤란 회신을 확인했습니다", detail: "사유는 기록에 남았습니다. 다음 후보 한 곳을 선택하세요.", tone: "red" as const };
      if (state.stage === "accepted") return { icon: CheckCircle2, title: "수용 가능 회신이 도착했습니다", detail: "환자 상태와 이동 여건을 다시 확인한 뒤 이송지를 확정하세요.", tone: "green" as const };
      if (state.stage === "destination-confirmed") return { icon: Route, title: "이송지를 확인했습니다", detail: "현장 출발 버튼을 누르면 출발시각이 기록됩니다.", tone: "teal" as const };
      return { icon: Hospital, title: "병원 진행을 확인하세요", detail: "문의·회신·이송지 확정 기록을 한곳에서 확인합니다.", tone: "slate" as const };
    })();
    const Icon = status.icon;

    return (
      <>
        <section className={styles.statusHero} data-tone={status.tone}>
          <span><Icon size={26} /></span><div><small>현재 진행</small><h1>{status.title}</h1></div>
        </section>

        <section className={styles.coordinationSteps} aria-label="병원 문의 순서">
          <div data-active={canStartRequest}><span>1</span><small>한 곳 문의</small></div>
          <i />
          <div data-active={activeRequest || state.stage === "accepted"}><span>2</span><small>회신 확인</small></div>
          <i />
          <div data-active={state.destinationConfirmed}><span>3</span><small>이송지 확정</small></div>
        </section>

        <section className={styles.candidateSection}>
          <div className={styles.candidateHeading}>
            <div><span>{SCENARIO.sceneLocation ? "신고 현장 기준" : "현재 위치 기준"}</span><h2>병원 후보 {HOSPITALS.length}곳</h2></div>
            <StatusBadge tone={activeRequest ? "amber" : "teal"}>{activeRequest ? "1곳 문의 중" : "순차 문의"}</StatusBadge>
          </div>
          <p className={styles.candidateRule}><Info size={16} /> 거리·시간은 참고 정보이며 수용 여부는 병원 회신으로 확인합니다.</p>

          <div className={styles.candidateList}>
            {HOSPITALS.map((hospital) => {
              const candidateState = candidateStatus(hospital);
              const requestEvent = requestEventFor(hospital);
              const statusLabel: Record<HospitalCandidateStatus, string> = {
                available: "문의 가능",
                locked: "현재 문의 후",
                pending: "회신 대기",
                info: "추가 확인",
                accepted: "수용 가능",
                declined: "수용 곤란",
                confirmed: "이송지 확정",
              };

              return (
                <article className={styles.hospitalCandidate} data-status={candidateState} key={hospital.id}>
                  <div className={styles.candidateTop}>
                    <span className={styles.candidateOrder}><Hospital size={14} /></span>
                    <div className={styles.candidateName}>
                      <h3>{hospital.name}</h3>
                      <p><MapPin size={12} /> {hospital.address ?? hospital.location}</p>
                    </div>
                    <span className={styles.candidateStatus} data-status={candidateState}>{statusLabel[candidateState]}</span>
                  </div>

                  <div className={styles.candidateTravel}>
                    <span><Route size={15} /><small>{hospital.isRoadRoute === false ? "직선거리" : operational ? "도로거리" : "저장 도로거리"}</small><strong>{hospital.distance}</strong></span>
                    <span><Clock3 size={15} /><small>예상 이동</small><strong>{hospital.eta}</strong></span>
                  </div>

                  <div className={styles.candidateReferences}>
                    {hospital.reference.map((item) => <span key={item}>{item}</span>)}
                  </div>

                  {candidateState === "pending" && (
                    <div className={styles.responseStrip} data-tone="amber"><Clock3 size={16} /><span><strong>병원 회신 대기</strong><small>{requestEvent?.time ?? "방금"} 문의 · 열람 여부와 회신을 확인합니다.</small></span></div>
                  )}
                  {candidateState === "info" && (
                    <div className={styles.responseStrip} data-tone="amber"><FileText size={16} /><span><strong>{state.requestedInfo.join(" · ") || "추가정보"} 요청</strong><small>확인할 수 없으면 빈칸 대신 ‘미상’으로 회신합니다.</small></span></div>
                  )}
                  {candidateState === "declined" && (
                    <div className={styles.responseStrip} data-tone="red"><AlertTriangle size={16} /><span><strong>수용 곤란 사유</strong><small>{declineReasonFor(hospital)}</small></span></div>
                  )}
                  {candidateState === "accepted" && (
                    <div className={styles.responseStrip} data-tone="green"><CheckCircle2 size={16} /><span><strong>수용 가능 회신</strong><small>이송 출발 전 구급대원이 최종 확정합니다.</small></span></div>
                  )}
                  {candidateState === "confirmed" && (
                    <div className={styles.responseStrip} data-tone="green"><Navigation size={16} /><span><strong>최종 이송병원</strong><small>이송 시작 전 환자 상태와 경로를 다시 확인하세요.</small></span></div>
                  )}

                  <div className={styles.candidateActions}>
                    {candidateState === "available" && canStartRequest && (
                      <button aria-label={`${hospital.name}에 수용 문의`} className={styles.candidatePrimary} onClick={() => { dispatch({ type: "REQUEST_HOSPITAL", hospitalId: hospital.id }); notify(`${hospital.name}에 수용 문의를 보냈습니다.`); }}>
                        <Send size={16} /> 이 병원에 수용 문의
                      </button>
                    )}
                    {["pending", "info", "accepted", "declined", "confirmed"].includes(candidateState) && (
                      <button className={styles.candidateSecondary} onClick={() => setCallingHospitalId(hospital.id)}>
                        <Phone size={16} /> 통화 결과 기록
                      </button>
                    )}
                    {candidateState === "info" && (
                      <button className={styles.candidatePrimary} data-tone="amber" onClick={() => dispatch({ type: "ANSWER_INFO" })}>
                        <Send size={16} /> 확인값·미상 구분해 회신
                      </button>
                    )}
                    {candidateState === "accepted" && (
                      <button className={styles.candidatePrimary} data-tone="green" onClick={() => dispatch({ type: "CONFIRM_DESTINATION" })}>
                        <CheckCircle2 size={16} /> 이송병원으로 확정
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {(state.stage === "summary-ready" || state.stage === "declined") && (
            <button className={styles.supportAction} onClick={() => dispatch({ type: "REQUEST_COORDINATION" })}>
              <RadioTower size={16} /> 상황실 연락 지원 요청
            </button>
          )}
        </section>

        {state.destinationConfirmed && selectedHospital && (
          <section className={styles.confirmedDestination}>
            <span><Navigation size={20} /></span>
            <div><small>최종 이송병원</small><strong>{selectedHospital.name}</strong><p>예상 {selectedHospital.eta} · {selectedHospital.distance}</p></div>
          </section>
        )}

        {state.stage === "destination-confirmed" && (
          <button className={styles.fullAction} onClick={() => { transition("transporting", "구급대원", "이송 시작", `${selectedHospital?.name} · ETA ${selectedHospital?.eta}`, "teal"); setTab("field"); }}>
            <Ambulance size={19} /> 이송 시작
          </button>
        )}

        <section className={styles.mobileTimeline}>
          <div className={styles.sectionTitle}><div><Clock3 size={18} /><strong>요청 진행 기록</strong></div></div>
          {[...state.events].reverse().filter((event) => ["병원", "이송조정 상황실", "구급대원"].includes(event.actor)).slice(0, 5).map((event) => (
            <div className={styles.timelineEvent} key={event.id}><time>{event.time}</time><i data-tone={event.tone ?? "neutral"} /><span><strong>{event.title}</strong><small>{event.detail}</small></span></div>
          ))}
        </section>
      </>
    );
  };

  const renderTransport = () => (
    <>
      <section className={styles.transportMap}>
        {selectedHospital?.latitude !== undefined && selectedHospital.longitude !== undefined
          && SCENARIO.latitude !== undefined && SCENARIO.longitude !== undefined ? (
          <KakaoRouteMap
            origin={{ latitude: SCENARIO.latitude, longitude: SCENARIO.longitude }}
            originName={SCENARIO.locationName ?? "신고 현장"}
            destination={{ latitude: selectedHospital.latitude, longitude: selectedHospital.longitude }}
            destinationName={selectedHospital.name}
            path={transportRoute?.path}
          />
        ) : (
          <div className={styles.mapUnavailable} role="status">
            <MapPinned size={25} />
            <strong>병원 위치를 확인하는 중</strong>
            <small>기관 위치가 확인되면 이송 경로가 표시됩니다.</small>
          </div>
        )}
        <div className={styles.etaPanel}><span>예상 도착</span><strong>{transportRoute?.eta_minutes !== null && transportRoute?.eta_minutes !== undefined ? `${transportRoute.eta_minutes}분` : selectedHospital?.eta ?? "경로 조회 전"}</strong><small>{selectedHospital?.name ?? "이송지 미확정"} · {transportRoute?.is_live ? "실시간 경로" : operational ? "경로 조회 중" : "저장 경로"}</small></div>
      </section>
      <section className={styles.transportStatus}>
        <div><span>이송 시작</span><strong>{timeFor("이송 시작")}</strong></div>
        <div><span>최근 갱신</span><strong>{state.reassessmentSaved ? timeFor("이송 중 재평가", "이송 전 재평가 확인", "추가정보 회신") : timeFor("이송 시작")}</strong></div>
        <div><span>상태 공유</span><strong>{state.reassessmentSaved ? "병원 전달됨" : "최초 상태"}</strong></div>
      </section>
      <section className={styles.recheckCard}>
        <div className={styles.sectionTitle}><div><Activity size={18} /><strong>최근 재평가</strong></div><StatusBadge tone={state.reassessmentSaved ? "green" : "slate"}>{state.reassessmentSaved ? "저장됨" : "미기록"}</StatusBadge></div>
        <div className={styles.recheckValues}><span>AVPU <b>{state.avpu}</b></span><span>BP <b>{state.reassessmentVitals?.bp ?? "—"}</b> mmHg</span><span>SpO₂ <b>{state.reassessmentVitals ? `${state.reassessmentVitals.spo2}%` : "—"}</b></span><span>증상 <b>{state.reassessmentSaved ? state.reassessmentSummary : "확인 전"}</b></span></div>
        {!state.reassessmentSaved && (
          <>
            <button
              className={styles.pttButton}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onClick={handleVoiceClick}
              aria-label="재평가 음성 입력 시작. 탭하여 시작한 뒤 화면의 종료 버튼을 누르거나, 누른 채 말하고 손을 떼어 종료합니다."
            ><Mic size={18} /> 재평가 음성 입력</button>
            <button onClick={() => setShowReassessmentForm((current) => !current)}><RefreshCw size={17} /> 측정값 직접 입력</button>
            {showReassessmentForm && (
              <div className={styles.reassessmentForm}>
                {vitalFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <div><input inputMode="decimal" value={reassessmentDraft[field.key]} onChange={(event) => setReassessmentDraft((current) => ({ ...current, [field.key]: event.target.value }))} /><small>{field.unit}</small></div>
                  </label>
                ))}
                <label className={styles.trendField}><span>증상 변화</span><input value={reassessmentTrend} onChange={(event) => setReassessmentTrend(event.target.value)} /></label>
                <button className={styles.saveReassessment} disabled={Object.values(reassessmentDraft).some((value) => !value.trim()) || !reassessmentTrend.trim()} onClick={() => {
                  dispatch({ type: "SAVE_REASSESSMENT", values: reassessmentDraft, symptomTrend: reassessmentTrend });
                  setShowReassessmentForm(false);
                }}><Check size={17} /> 측정시각과 함께 저장</button>
              </div>
            )}
          </>
        )}
      </section>
      <button className={styles.fullAction} onClick={() => { transition("hospital-arrived", "구급대원", "병원 도착", `${selectedHospital?.name} · GPS 및 사용자 확인`, "teal"); setTab("handoff"); }}>
        <Hospital size={19} /> 병원 도착
      </button>
    </>
  );

  const renderHandoff = () => (
    <>
      <section className={styles.handoffHero} data-complete={state.stage === "complete"}>
        <span>{state.stage === "complete" ? <CheckCircle2 size={30} /> : <ClipboardCheck size={30} />}</span>
        <div><small>{state.stage === "complete" ? "환자 인수 완료" : state.stage === "handoff-sent" ? "병원 인수 확인 대기" : `병원 도착 ${timeFor("병원 도착")}`}</small><h1>{state.stage === "complete" ? "인계가 완료되었습니다" : "최종 인계 내용을 확인하세요"}</h1><p>{selectedHospital?.name}</p></div>
      </section>
      <section className={styles.handoffCard}>
        <div className={styles.sectionTitle}><div><FileText size={18} /><strong>구두·전자 인계 카드</strong></div><SourceTag tone="confirmed">최종 확인본</SourceTag></div>
        <dl>
          <div><dt>환자</dt><dd>{SCENARIO.patient} · {SCENARIO.living}</dd></div>
          <div><dt>주증상</dt><dd>{SCENARIO.chiefComplaint}</dd></div>
          <div><dt>ABC</dt><dd>A {SCENARIO.primarySurvey.airway} · B {SCENARIO.primarySurvey.breathing} · C {SCENARIO.primarySurvey.circulation}</dd></div>
          <div><dt>발생시각</dt><dd>{SCENARIO.onset} · {SCENARIO.onsetSource}</dd></div>
          <div><dt>동반증상</dt><dd>{SCENARIO.symptoms.join(" · ") || "미확인"}</dd></div>
          <div><dt>최초 활력</dt><dd>BP {state.vitals.bp} · PR {state.vitals.pr} · SpO₂ {state.vitals.spo2}%</dd></div>
          <div><dt>재평가</dt><dd>{state.reassessmentVitals ? `AVPU ${state.avpu} · BP ${state.reassessmentVitals.bp} · SpO₂ ${state.reassessmentVitals.spo2}% · ${state.reassessmentSummary}` : "추가 기록 없음"}</dd></div>
          <div><dt>처치</dt><dd>{SCENARIO.interventions.join(" · ") || (operational ? "기록 없음" : CARDIO_DEMO_HANDOFF.sections.treatment.join(" · "))}</dd></div>
          <div><dt>미상 항목</dt><dd>{SCENARIO.unresolvedItems.join(" · ") || "없음"}</dd></div>
        </dl>
      </section>
      {state.stage === "hospital-arrived" && (
        <button className={styles.fullAction} onClick={() => dispatch({ type: "SET_HANDOFF", receiver: "", role: operational ? "" : "간호사" })}>
          <Send size={19} /> 구두·전자 인계 완료
        </button>
      )}
      {state.stage === "handoff-sent" && <div className={styles.waitingBox}><span className={styles.pulseDot} /><div><strong>병원 인수 확인을 기다리고 있습니다</strong><small>병원 담당자가 인수해야 사건이 종료됩니다.</small></div></div>}
      {state.stage === "complete" && (
        <>
          <section className={styles.completeDetails}>
            <div><span>인수자</span><strong>{state.handoffRole} {state.handoffReceiver}</strong></div>
            <div><span>인수시각</span><strong>{timeFor("환자 인수 확인")}</strong></div>
            <div><span>사건상태</span><strong>환자 인수 완료</strong></div>
          </section>
          <button className={styles.fullAction} onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("view", "report");
            window.location.assign(url.toString());
          }}><FileText size={19} /> 구급활동 기록 검토</button>
        </>
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
  if (!caseOpen) body = renderCaseList();
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
    <div className={`${styles.mobileStage} ${operational ? styles.operationalStage : ""}`}>
      <section className={`${styles.device} ${operational ? styles.operationalDevice : ""}`} aria-label="EMS Relay 구급대원 모바일 화면">
        {phoneHeader}
        {body}
        {toast && <div className={styles.toast} role="status"><CheckCircle2 size={18} /> {toast}</div>}

        {callingHospital && (
          <div className={styles.callOverlay} role="dialog" aria-modal="true" aria-label={`${callingHospital.name} 통화 결과 기록`}>
            <section className={styles.callSheet}>
              <button className={styles.callClose} aria-label="전화 연결 닫기" onClick={() => setCallingHospitalId(null)}><X size={18} /></button>
              <span className={styles.callIcon}><Phone size={24} /></span>
              <small>병원 통화 결과 기록</small>
              <h2>{callingHospital.name}</h2>
              <div className={styles.callSummary}>
                <span><strong>{SCENARIO.patient}</strong><small>{SCENARIO.chiefComplaint}</small></span>
                <span><strong>발생 {SCENARIO.onset}</strong><small>{SCENARIO.symptoms.join(" · ")}</small></span>
              </div>
              <p className={styles.callHint}><AlertTriangle size={15} /> 이 화면은 전화를 연결하지 않습니다. 별도 통화 후 결과만 기록하며, 수용 가능 회신은 병원 화면에서 확인합니다.</p>
              <div className={styles.callResults}>
                <button onClick={() => {
                  dispatch({ type: "CALL_HOSPITAL", hospitalId: callingHospital.id, result: "응답 없음" });
                  setCallingHospitalId(null);
                  notify("응답 없음으로 통화 기록을 남겼습니다.");
                }}>응답 없음</button>
                <button onClick={() => {
                  dispatch({ type: "CALL_HOSPITAL", hospitalId: callingHospital.id, result: "연결됨 · 수용 여부 미확정" });
                  setCallingHospitalId(null);
                  notify("연결됨으로 통화 기록을 남겼습니다.");
                }}><Phone size={17} /> 연결됨</button>
              </div>
            </section>
          </div>
        )}

        {voiceMode && (
          <div className={styles.voiceOverlay} role="dialog" aria-modal="true" aria-label="음성으로 환자 상태 기록" aria-busy={voiceMode === "stopping" || voiceMode === "processing"}>
            <button className={styles.voiceClose} aria-label="음성 입력 닫기" onClick={cancelVoice}><X size={19} /></button>
            {voiceMode === "listening" ? (
              <div className={styles.listeningPanel}>
                <span className={styles.micPulse}><Mic size={27} /></span>
                <h2>{!scriptedPtt && transcribe.state === "starting" ? "마이크를 연결하고 있습니다" : "듣고 있습니다"}</h2>
                <p>{!scriptedPtt && transcribe.state === "starting" ? "연결되면 바로 말씀하실 수 있습니다." : "환자를 보면서 평소 말하듯 말씀하세요."}</p>
                <div className={styles.liveTranscript}>{scriptedPtt ? transcriptSteps[transcriptIndex] : transcribe.transcript || "음성을 인식하고 있습니다…"}<i /></div>
                <button disabled={!voiceStopReady} onClick={finishVoice}>{voiceStopReady ? "입력 종료하고 내용 확인" : "음성 입력을 시작하고 있습니다"}</button>
              </div>
            ) : voiceMode === "stopping" ? (
              <div className={styles.listeningPanel} role="status" aria-live="polite">
                <span className={styles.micPulse}><Mic size={27} /></span>
                <h2>음성 입력을 마치고 있습니다</h2>
                <p>마지막 문장이 빠지지 않도록 인식 결과를 확인합니다.</p>
                <div className={styles.liveTranscript}>{transcribe.transcript || spokenTranscript || "마지막 음성을 확인하고 있습니다…"}</div>
                <button onClick={cancelVoice}>입력 취소</button>
              </div>
            ) : voiceMode === "processing" ? (
              <div className={styles.listeningPanel} role="status" aria-live="polite">
                <span className={styles.micPulse}><Activity size={27} /></span>
                <h2>환자 상태를 정리하고 있습니다</h2>
                <p>말한 내용을 구조화하고 확인할 항목을 준비합니다.</p>
                <div className={styles.liveTranscript}>{spokenTranscript || transcribe.transcript || "입력 내용을 확인하고 있습니다."}</div>
                <button onClick={cancelVoice}>처리 취소</button>
              </div>
            ) : voiceResult ? (
              <div className={styles.voiceReview}>
                <span className={styles.reviewIcon}><ClipboardCheck size={25} /></span>
                <h2>{voiceResult.update.title} 변경안을 확인하세요</h2>
                <p>{voiceResult.response.review_summary.message} 선택한 값만 구급대원 확인 정보로 반영됩니다.</p>
                <div className={styles.transcriptBox}>“{voiceResult.update.transcript}”</div>
                {voiceResult.response.warnings.length > 0 && (
                  <div className={styles.warningBox}><AlertTriangle size={17} /><span><strong>확인 필요 {voiceResult.response.warnings.length}건</strong><small>{voiceResult.response.warnings.map((warning) => warning.message).join(" · ")}</small></span></div>
                )}
                {voiceConfirmError && (
                  <div className={styles.warningBox} role="alert"><AlertTriangle size={17} /><span><strong>확정하지 못했습니다</strong><small>{voiceConfirmError}</small></span></div>
                )}
                <div className={styles.extractedList}>
                  {voiceResult.update.proposals.map((proposal) => {
                    const accepted = acceptedProposalIds.includes(proposal.id);
                    return (
                      <button
                        className={accepted ? styles.choiceActive : ""}
                        disabled={isConfirmingVoice}
                        onClick={() => setAcceptedProposalIds((current) => current.includes(proposal.id) ? current.filter((id) => id !== proposal.id) : [...current, proposal.id])}
                        key={proposal.id}
                        aria-pressed={accepted}
                      >
                        <span>{proposal.label}</span>
                        <strong>{proposal.displayValue}</strong>
                        <SourceTag tone={reviewTone(proposal.status)}>{proposal.status === "unknown" ? "미상" : proposal.status === "unconfirmed" ? "진술 기반" : proposal.status === "pending_review" ? "판단 확인" : "확인 후보"}</SourceTag>
                      </button>
                    );
                  })}
                </div>
                <div className={styles.reviewActions}>
                  <button disabled={isConfirmingVoice} onClick={cancelVoice}>취소</button>
                  <button disabled={!acceptedProposalIds.length || isConfirmingVoice} onClick={() => void applyReviewedVoice()}>
                    {isConfirmingVoice ? <RefreshCw className={styles.spinning} size={18} /> : <Check size={18} />}
                    {isConfirmingVoice ? "확정 저장 중" : "선택 항목 반영"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.listeningPanel}><AlertTriangle size={28} /><h2>변경안을 불러오지 못했습니다</h2><p>{voiceError ?? "기존 환자정보는 변경되지 않았습니다."}</p><button onClick={cancelVoice}>닫기</button></div>
            )}
          </div>
        )}
      </section>

      {!operational && <aside className={styles.mobileGuide}>
        <span className={styles.guideKicker}>현재 단계</span>
        <h2>{STAGE_LABEL[state.stage]}</h2>
        <p>구급대원이 확인한 정보와 버튼 입력 시각만 공통 사건에 반영됩니다.</p>
        <div className={styles.guidePatient}>
          <span><UserRound size={18} /></span>
          <div><strong>{state.stage === "assigned" || state.stage === "enroute" ? SCENARIO.reportedPatient : SCENARIO.patient}</strong><small>{state.stage === "assigned" || state.stage === "enroute" ? SCENARIO.reportedComplaint : SCENARIO.chiefComplaint}</small></div>
        </div>
        <div className={styles.guideEvents}>
          {[...state.events].reverse().slice(0, 4).map((event) => (
            <div key={event.id}><time>{event.time}</time><span><strong>{event.title}</strong><small>{event.actor}</small></span></div>
          ))}
        </div>
        <div className={styles.guideRule}><ShieldCheck size={17} /><span><strong>확인한 값만 반영됩니다</strong><small>말한 내용은 변경안으로 정리되고 구급대원이 확인해야 저장됩니다.</small></span></div>
      </aside>}
    </div>
  );
}
