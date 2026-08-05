"use client";

import { currentAccessToken } from "@/lib/cognitoAuth";
import { createInitialV2Store } from "./fixtures";
import {
  assessmentComplete,
  cpssScore,
  DEMO_RESET_CONFIRMATION,
  type Avpu,
  type DemoResetResult,
  type DispatchCase,
  type Hospital,
  type HospitalDecision,
  type HospitalInboxItem,
  type HospitalRequest,
  type HospitalRequestStatus,
  type PatientAssessment,
  type Sex,
  type SpeechFinding,
  type StrokeSide,
  type TranscribeSession,
  type V2Store,
  type VoiceProposal,
  type VoiceProposalChange,
  type VoiceUpdateFocus,
  type V2CaseUpdate,
  type V2RealtimeScope,
  type V2RealtimeStatus,
} from "./types";

export type V2StoreListener = (store: V2Store) => void;

export interface EmsV2Api {
  subscribe(listener: V2StoreListener): () => void;
  watchUpdates(
    scope: V2RealtimeScope,
    listener: (update: V2CaseUpdate) => void,
    onStatus?: (status: V2RealtimeStatus) => void,
  ): () => void;
  getStore(): Promise<V2Store>;
  listMyCases(): Promise<DispatchCase[]>;
  getCase(caseId: string): Promise<DispatchCase>;
  listHospitals(): Promise<Hospital[]>;
  listHospitalInbox(hospitalId: string): Promise<HospitalInboxItem[]>;
  startDispatch(caseId: string): Promise<DispatchCase>;
  arriveScene(caseId: string): Promise<DispatchCase>;
  contactPatient(caseId: string): Promise<DispatchCase>;
  saveAssessment(caseId: string, assessment: PatientAssessment): Promise<DispatchCase>;
  confirmPatientCard(caseId: string): Promise<DispatchCase>;
  startMatching(caseId: string): Promise<void>;
  markRequestViewed(caseId: string, requestId: string, hospitalId: string): Promise<HospitalRequest>;
  respondToRequest(caseId: string, requestId: string, hospitalId: string, decision: HospitalDecision, reason?: string): Promise<HospitalRequest>;
  selectDestination(caseId: string, requestId: string): Promise<DispatchCase>;
  startTransport(caseId: string): Promise<DispatchCase>;
  arriveHospital(caseId: string): Promise<DispatchCase>;
  createTranscribeSession(caseId: string): Promise<TranscribeSession>;
  structureVoiceUpdate(caseId: string, transcript: string, focus?: VoiceUpdateFocus): Promise<VoiceProposal>;
  resetDemoCases(confirmation: string): Promise<DemoResetResult>;
}

const STORAGE_KEY = "ems-relay:v2:local-store";
const CHANNEL_NAME = "ems-relay:v2:updates";

function now() {
  return new Date().toISOString();
}

function localVoiceProposal(caseId: string, transcript: string): VoiceProposal {
  const changes: VoiceProposalChange[] = [];
  const add = (path: string, match: RegExpMatchArray | null, unit?: string, index = 1) => {
    if (!match?.[index]) return;
    changes.push({
      changeId: crypto.randomUUID(),
      path,
      value: Number(match[index]),
      ...(unit ? { unit } : {}),
      certainty: "clear",
      sourceText: match[0],
    });
  };
  const bloodPressure = transcript.match(/(?:혈압\s*)?(\d{2,3})\s*(?:에|\/|대)\s*(\d{2,3})/);
  add("vitals.systolicBp", bloodPressure, "mmHg", 1);
  add("vitals.diastolicBp", bloodPressure, "mmHg", 2);
  add("vitals.pulse", transcript.match(/(?:맥박|심박수)\s*(?:는|은)?\s*(\d{2,3})/), "/min");
  add("vitals.respiratoryRate", transcript.match(/호흡수\s*(?:는|은)?\s*(\d{1,2})/), "/min");
  add("vitals.spo2", transcript.match(/(?:산소포화도|에스피오투|SpO2)\s*(?:는|은)?\s*(\d{2,3})/i), "%");
  add("vitals.glucose", transcript.match(/(?:혈당|혈당치)\s*(?:는|은)?\s*(\d{2,3})/), "mg/dL");
  add("vitals.temperature", transcript.match(/(?:체온)\s*(?:는|은)?\s*(\d{2}(?:\.\d)?)/), "°C");
  return {
    proposalId: `LOCAL-${crypto.randomUUID()}`,
    caseId,
    baseVersion: 0,
    status: "PENDING",
    summary: changes.length ? `음성에서 ${changes.length}개 항목을 정리했습니다.` : "확실하게 정리할 수 있는 항목이 없습니다.",
    changes,
    flags: [],
    createdAt: now(),
    requiresHumanReview: true,
  };
}

function ensureCase(store: V2Store, caseId: string) {
  const incident = store.cases.find((item) => item.id === caseId);
  if (!incident) throw new Error("출동 사건을 찾을 수 없습니다.");
  return incident;
}

function assertStage(incident: DispatchCase, allowed: DispatchCase["stage"][]) {
  if (!allowed.includes(incident.stage)) throw new Error("현재 단계에서는 이 작업을 수행할 수 없습니다.");
}

export class LocalEmsV2Api implements EmsV2Api {
  private memory = createInitialV2Store();
  private listeners = new Set<V2StoreListener>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener("message", () => this.emit(this.read()));
    }
  }

  subscribe(listener: V2StoreListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watchUpdates() {
    return () => undefined;
  }

  async getStore() { return this.read(); }
  async listMyCases() { return this.read().cases; }
  async getCase(caseId: string) { return ensureCase(this.read(), caseId); }
  async listHospitals() { return this.read().hospitals; }

  async listHospitalInbox(hospitalId: string) {
    const store = this.read();
    return store.requests
      .filter((request) => request.hospitalId === hospitalId)
      .map((request) => ({
        request,
        incident: ensureCase(store, request.caseId),
        hospital: store.hospitals.find((item) => item.id === hospitalId)!,
      }))
      .sort((left, right) => right.request.requestedAt.localeCompare(left.request.requestedAt));
  }

  async startDispatch(caseId: string) {
    return this.updateCase(caseId, ["assigned"], (incident) => {
      incident.stage = "enroute";
      incident.timeline.dispatchStartedAt = now();
    });
  }

  async arriveScene(caseId: string) {
    return this.updateCase(caseId, ["enroute"], (incident) => {
      incident.stage = "scene-arrived";
      incident.timeline.sceneArrivedAt = now();
    });
  }

  async contactPatient(caseId: string) {
    return this.updateCase(caseId, ["scene-arrived"], (incident) => {
      incident.stage = "patient-contact";
      incident.timeline.patientContactAt = now();
    });
  }

  async saveAssessment(caseId: string, assessment: PatientAssessment) {
    return this.updateCase(caseId, ["patient-contact", "assessing"], (incident) => {
      incident.stage = "assessing";
      incident.assessment = { ...incident.assessment, ...assessment };
    });
  }

  async confirmPatientCard(caseId: string) {
    return this.updateCase(caseId, ["assessing", "patient-contact"], (incident) => {
      if (!assessmentComplete(incident.assessment)) throw new Error("필수 환자 평가를 모두 확인해 주세요.");
      const confirmedAt = now();
      incident.patientCard = {
        ...incident.assessment,
        cpss: cpssScore(incident.assessment),
        confirmedAt,
        confirmedBy: "paramedic",
      };
      incident.stage = "card-confirmed";
      incident.timeline.cardConfirmedAt = confirmedAt;
    });
  }

  async startMatching(caseId: string) { this.createWave(caseId, 1); }

  async markRequestViewed(caseId: string, requestId: string, hospitalId: string) {
    return this.mutate((store) => {
      const request = this.ensureRequest(store, caseId, requestId, hospitalId);
      if (request.status === "REQUESTED") {
        request.status = "VIEWED";
        request.viewedAt = now();
      }
      return request;
    });
  }

  async respondToRequest(caseId: string, requestId: string, hospitalId: string, decision: HospitalDecision, reason?: string) {
    return this.mutate((store) => {
      const request = this.ensureRequest(store, caseId, requestId, hospitalId);
      if (!(request.status === "REQUESTED" || request.status === "VIEWED")) throw new Error("이미 회신이 완료된 요청입니다.");
      request.status = decision;
      request.respondedAt = now();
      if (reason?.trim()) request.reason = reason.trim();
      return request;
    });
  }

  async selectDestination(caseId: string, requestId: string) {
    return this.mutate((store) => {
      const incident = ensureCase(store, caseId);
      assertStage(incident, ["matching"]);
      const selected = store.requests.find((request) => request.id === requestId && request.caseId === caseId);
      if (!selected || selected.status !== "ACCEPTED") throw new Error("수용 가능 회신을 받은 병원만 선택할 수 있습니다.");
      incident.destinationRequestId = selected.id;
      incident.stage = "destination-selected";
      incident.version += 1;
      store.requests.forEach((request) => {
        if (request.caseId === caseId && request.id !== selected.id && ["REQUESTED", "VIEWED", "ACCEPTED"].includes(request.status)) request.status = "CLOSED";
      });
      return incident;
    });
  }

  async startTransport(caseId: string) {
    return this.updateCase(caseId, ["destination-selected"], (incident) => {
      incident.stage = "transporting";
      incident.timeline.transportStartedAt = now();
    });
  }

  async arriveHospital(caseId: string) {
    return this.updateCase(caseId, ["transporting"], (incident) => {
      incident.stage = "arrived";
      incident.timeline.hospitalArrivedAt = now();
    });
  }

  async createTranscribeSession(): Promise<TranscribeSession> {
    throw new Error("로컬 모드에서는 브라우저 음성 인식을 사용합니다.");
  }

  async structureVoiceUpdate(caseId: string, transcript: string) {
    return localVoiceProposal(caseId, transcript);
  }

  async resetDemoCases(confirmation: string) {
    if (confirmation !== DEMO_RESET_CONFIRMATION) {
      throw new Error(`시연 초기화를 실행하려면 확인 문구 ${DEMO_RESET_CONFIRMATION}를 정확히 입력하세요.`);
    }
    const fresh = createInitialV2Store();
    const caseIds = fresh.cases.map((incident) => incident.id);
    const demoIds = new Set(caseIds);
    const resetAt = now();
    return this.mutate((store) => {
      const deletedItems = store.cases.filter((incident) => demoIds.has(incident.id)).length
        + store.requests.filter((request) => demoIds.has(request.caseId)).length
        + store.routes.filter((route) => demoIds.has(route.caseId)).length;
      store.cases = [...store.cases.filter((incident) => !demoIds.has(incident.id)), ...fresh.cases];
      store.requests = store.requests.filter((request) => !demoIds.has(request.caseId));
      store.routes = [...store.routes.filter((route) => !demoIds.has(route.caseId)), ...fresh.routes];
      return { caseIds, deletedItems, restoredItems: fresh.cases.length, resetAt };
    });
  }

  private read(): V2Store {
    if (typeof window === "undefined") return structuredClone(this.memory);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialV2Store();
    try { return JSON.parse(raw) as V2Store; } catch { return createInitialV2Store(); }
  }

  private write(store: V2Store) {
    store.updatedAt = now();
    this.memory = structuredClone(store);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    this.channel?.postMessage({ updatedAt: store.updatedAt });
    this.emit(store);
  }

  private emit(store: V2Store) {
    const snapshot = structuredClone(store);
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private mutate<T>(change: (store: V2Store) => T): T {
    const store = this.read();
    const value = change(store);
    this.write(store);
    return structuredClone(value);
  }

  private updateCase(caseId: string, allowed: DispatchCase["stage"][], change: (incident: DispatchCase) => void) {
    return this.mutate((store) => {
      const incident = ensureCase(store, caseId);
      assertStage(incident, allowed);
      change(incident);
      incident.version += 1;
      return incident;
    });
  }

  private createWave(caseId: string, wave: number) {
    return this.mutate((store) => {
      const incident = ensureCase(store, caseId);
      assertStage(incident, wave === 1 ? ["card-confirmed"] : ["matching"]);
      if (!incident.patientCard) throw new Error("확정 환자 카드가 필요합니다.");
      const requestedHospitalIds = new Set(store.requests.filter((item) => item.caseId === caseId).map((item) => item.hospitalId));
      const routes = store.routes.filter((route) => route.caseId === caseId && route.wave === wave && !requestedHospitalIds.has(route.hospitalId));
      if (!routes.length) throw new Error("추가 요청 가능한 병원이 없습니다.");
      const requestedAt = now();
      const requests: HospitalRequest[] = routes.map((route) => ({
        id: `REQ-${caseId}-${route.hospitalId}-${crypto.randomUUID()}`,
        caseId,
        hospitalId: route.hospitalId,
        hospitalName: store.hospitals.find((hospital) => hospital.id === route.hospitalId)?.name,
        wave,
        status: "REQUESTED",
        distanceKm: route.distanceKm,
        etaMinutes: route.etaMinutes,
        requestedAt,
      }));
      store.requests.push(...requests);
      incident.stage = "matching";
      incident.version += 1;
      return requests;
    });
  }

  private ensureRequest(store: V2Store, caseId: string, requestId: string, hospitalId: string) {
    const request = store.requests.find((item) => item.caseId === caseId && item.id === requestId && item.hospitalId === hospitalId);
    if (!request) throw new Error("해당 병원의 수용 요청을 찾을 수 없습니다.");
    return request;
  }
}

type AppSyncWebSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type AppSyncWebSocketFactory = (url: string, protocols: string[]) => AppSyncWebSocket;

export type GraphQLAdapterOptions = {
  endpoint: string;
  realtimeEndpoint?: string;
  getAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  webSocketFactory?: AppSyncWebSocketFactory;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type RawCaseSummary = {
  caseId: string;
  version: number;
  stage: string;
  scenario?: string;
  reportTime?: string;
  reportSummary?: string;
  reportDetail?: string;
  estimatedAge?: string;
  estimatedSex?: string;
  reporter?: string;
  station?: string;
  sceneAddress?: string;
  sceneLatitude?: number;
  sceneLongitude?: number;
  agency?: string;
  unitId?: string;
  vehicleNumber?: string;
  destinationHospitalId?: string;
  updatedAt: string;
};

type RawCaseSnapshot = {
  caseId: string;
  version: number;
  stage: string;
  confirmedState: unknown;
  meta: unknown;
  events: unknown;
  hospitalRequests: unknown;
};

type RawHospitalInboxItem = {
  requestId: string;
  caseId: string;
  hospitalId: string;
  hospitalName?: string;
  status: string;
  wave?: number;
  radiusKm?: number;
  distanceKm?: number;
  etaMinutes?: number;
  patientCard: unknown;
  createdAt: string;
  updatedAt: string;
};

type MatchingJob = {
  jobId: string;
  caseId: string;
  status: string;
  wave: number;
  radiusKm: number;
  maxRadiusKm: number;
  createdAt: string;
};

type RawVoiceProposal = Omit<VoiceProposal, "changes" | "flags" | "status" | "requiresHumanReview"> & {
  status: string;
  changes: unknown;
  flags: unknown;
  requiresHumanReview: boolean;
};

const CASE_SUMMARY_FIELDS = `
  caseId version stage scenario reportTime reportSummary reportDetail estimatedAge estimatedSex
  reporter station sceneAddress sceneLatitude sceneLongitude agency unitId vehicleNumber
  destinationHospitalId updatedAt
`;
const CASE_SNAPSHOT_FIELDS = "caseId version stage confirmedState meta events hospitalRequests";
const INBOX_FIELDS = "requestId caseId hospitalId hospitalName status wave radiusKm distanceKm etaMinutes patientCard createdAt updatedAt";
const CASE_UPDATE_FIELDS = "caseId version eventId eventType stage occurredAt requestId hospitalId requestStatus payload";
const MATCHING_JOB_FIELDS = "jobId caseId status wave radiusKm maxRadiusKm createdAt";

function parseJson<T>(value: unknown, fallback: T): T {
  // AppSync AWSJSON can arrive as either a JSON value, a JSON string, or a
  // double-encoded JSON string depending on the Lambda resolver boundary.
  // Decode the boundary defensively without ever evaluating arbitrary text.
  let parsed = value;
  for (let depth = 0; depth < 3 && typeof parsed === "string"; depth += 1) {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return fallback; }
  }
  return parsed && typeof parsed === "object" ? parsed as T : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown) { return typeof value === "string" && value.length ? value : undefined; }
function optionalNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

function factEntry(facts: Record<string, unknown>, path: string) {
  const item = facts[path];
  return record(item);
}

function factValue(facts: Record<string, unknown>, path: string) {
  const item = facts[path];
  if (item && typeof item === "object" && !Array.isArray(item) && "value" in item) return (item as { value: unknown }).value;
  return item;
}

function toSex(value: unknown): Sex | undefined {
  if (value === "female" || value === "여성") return "female";
  if (value === "male" || value === "남성") return "male";
  if (value === "unknown" || value === "미상") return "unknown";
  return undefined;
}

function toAirway(value: unknown): PatientAssessment["airway"] {
  if (value === "patent" || value === "개방") return "patent";
  if (value === "at-risk" || value === "확보 필요") return "at-risk";
  if (value === "obstructed" || value === "폐쇄") return "obstructed";
  return undefined;
}

function toBreathing(value: unknown): PatientAssessment["breathing"] {
  if (value === "adequate" || value === "자발호흡") return "adequate";
  if (value === "labored" || value === "호흡 곤란") return "labored";
  if (value === "inadequate" || value === "호흡 이상") return "inadequate";
  return undefined;
}

function toCirculation(value: unknown): PatientAssessment["circulation"] {
  if (value === "stable" || value === "맥박 촉지") return "stable";
  if (value === "poor-perfusion" || value === "순환 불안정") return "poor-perfusion";
  if (value === "arrest" || value === "심정지") return "arrest";
  return undefined;
}

function toSide(value: unknown): StrokeSide | undefined {
  if (value === "normal" || value === "정상") return "normal";
  if (value === "left" || value === "좌측 이상") return "left";
  if (value === "right" || value === "우측 이상") return "right";
  if (value === "unassessable" || value === "평가 불가") return "unassessable";
  return undefined;
}

function toSpeech(value: unknown): SpeechFinding | undefined {
  if (value === "normal" || value === "정상") return "normal";
  if (value === "dysarthria" || value === "구음장애") return "dysarthria";
  if (value === "aphasia" || value === "실어증") return "aphasia";
  if (value === "unassessable" || value === "평가 불가") return "unassessable";
  return undefined;
}

function timeFromObservedAt(value: unknown) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function assessmentFromFacts(facts: Record<string, unknown>): PatientAssessment {
  const vitalObservedAt = factEntry(facts, "vitals.systolicBp").observedAt;
  const avpu = factValue(facts, "consciousness.avpu");
  return {
    age: optionalNumber(factValue(facts, "patient.age")),
    sex: toSex(factValue(facts, "patient.sex")),
    airway: toAirway(factValue(facts, "assessment.airway")),
    breathing: toBreathing(factValue(facts, "assessment.breathing")),
    circulation: toCirculation(factValue(facts, "assessment.circulation")),
    avpu: (["A", "V", "P", "U"] as const).includes(avpu as Avpu) ? avpu as Avpu : undefined,
    chiefComplaint: optionalString(factValue(facts, "symptoms.chiefComplaint")),
    face: toSide(factValue(facts, "assessment.cpss.face")),
    arm: toSide(factValue(facts, "assessment.cpss.arm")),
    speech: toSpeech(factValue(facts, "assessment.cpss.speech")),
    systolicBp: optionalNumber(factValue(facts, "vitals.systolicBp")),
    diastolicBp: optionalNumber(factValue(facts, "vitals.diastolicBp")),
    pulse: optionalNumber(factValue(facts, "vitals.pulse")),
    respiratoryRate: optionalNumber(factValue(facts, "vitals.respiratoryRate")),
    spo2: optionalNumber(factValue(facts, "vitals.spo2")),
    glucose: optionalNumber(factValue(facts, "vitals.glucose")),
    temperature: optionalNumber(factValue(facts, "vitals.temperature")),
    lastKnownWell: optionalString(factValue(facts, "symptoms.lastKnownNormalAt")),
    lastKnownWellBasis: optionalString(factValue(facts, "symptoms.lastKnownNormalBasis")),
    firstAbnormalTime: optionalString(factValue(facts, "symptoms.firstAbnormalAt")),
    measuredAt: timeFromObservedAt(vitalObservedAt),
  };
}

function stageFromServer(stage: string, assessment: PatientAssessment): DispatchCase["stage"] {
  switch (stage) {
    case "DISPATCHING": return "enroute";
    case "ON_SCENE": return "scene-arrived";
    case "PATIENT_CONTACT": return "patient-contact";
    case "ASSESSING": return assessmentComplete(assessment) ? "card-confirmed" : "assessing";
    case "HOSPITAL_REQUESTED": return "matching";
    case "DESTINATION_CONFIRMED": return "destination-selected";
    case "TRANSPORTING": return "transporting";
    case "ARRIVED_HOSPITAL":
    case "HANDOFF":
    case "COMPLETE": return "arrived";
    default: return "assigned";
  }
}

function requestStatus(rawStatus: unknown, selectionStatus?: unknown): HospitalRequestStatus {
  if (selectionStatus === "NOT_SELECTED" || rawStatus === "CANCELLED") return "CLOSED";
  if (["REQUESTED", "VIEWED", "ACCEPTED", "DECLINED"].includes(String(rawStatus))) return rawStatus as HospitalRequestStatus;
  if (rawStatus === "INFO_REQUESTED" || rawStatus === "INFO_SENT") return "VIEWED";
  return "REQUESTED";
}

function hospitalRequestFromRaw(value: unknown): HospitalRequest | null {
  const item = record(value);
  const id = optionalString(item.requestId) ?? optionalString(item.id);
  const caseId = optionalString(item.caseId);
  const hospitalId = optionalString(item.hospitalId);
  if (!id || !caseId || !hospitalId) return null;
  const response = record(item.response);
  const latitude = optionalNumber(item.latitude) ?? optionalNumber(item.hospitalLatitude);
  const longitude = optionalNumber(item.longitude) ?? optionalNumber(item.hospitalLongitude);
  return {
    id,
    caseId,
    hospitalId,
    hospitalName: optionalString(item.hospitalName),
    hospitalAddress: optionalString(item.hospitalAddress) ?? optionalString(item.regionLabel) ?? optionalString(item.address),
    hospitalLocation: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
    wave: optionalNumber(item.wave) ?? 1,
    radiusKm: optionalNumber(item.radiusKm),
    status: requestStatus(item.status, item.selectionStatus),
    distanceKm: optionalNumber(item.distanceKm) ?? 0,
    etaMinutes: optionalNumber(item.etaMinutes) ?? 0,
    requestedAt: optionalString(item.createdAt) ?? now(),
    viewedAt: item.status === "VIEWED" ? optionalString(item.updatedAt) : undefined,
    respondedAt: ["ACCEPTED", "DECLINED"].includes(String(item.status)) ? optionalString(response.respondedAt) ?? optionalString(item.updatedAt) : undefined,
    reason: optionalString(response.reasonText) ?? optionalString(response.reasonCode),
  };
}

function timelineFromEvents(events: unknown[]) {
  const timeline: DispatchCase["timeline"] = {};
  for (const raw of events) {
    const event = record(raw);
    const occurredAt = optionalString(event.occurredAt);
    if (!occurredAt) continue;
    if (event.type === "DISPATCH_STARTED") timeline.dispatchStartedAt = occurredAt;
    if (event.type === "ARRIVED_SCENE") timeline.sceneArrivedAt = occurredAt;
    if (event.type === "PATIENT_CONTACT") timeline.patientContactAt = occurredAt;
    if (event.type === "PATIENT_FACTS_CONFIRMED") timeline.cardConfirmedAt = occurredAt;
    if (event.type === "TRANSPORT_STARTED") timeline.transportStartedAt = occurredAt;
    if (event.type === "ARRIVED_HOSPITAL") timeline.hospitalArrivedAt = occurredAt;
  }
  return timeline;
}

function displayTime(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function incidentFromSnapshot(snapshot: RawCaseSnapshot, summary?: RawCaseSummary): DispatchCase {
  const fixtures = createInitialV2Store();
  const fallback = fixtures.cases.find((item) => item.id === snapshot.caseId) ?? fixtures.cases[0];
  const meta = parseJson<Record<string, unknown>>(snapshot.meta, {});
  const confirmed = parseJson<Record<string, unknown>>(snapshot.confirmedState, {});
  const facts = record(confirmed.facts);
  const assessment = assessmentFromFacts(facts);
  const parsedRequests = parseJson<unknown>(snapshot.hospitalRequests, []);
  const rawRequests = Array.isArray(parsedRequests) ? parsedRequests : [];
  const hospitalRequests = rawRequests.map(hospitalRequestFromRaw).filter((item): item is HospitalRequest => item !== null);
  const parsedEvents = parseJson<unknown>(snapshot.events, []);
  const events = Array.isArray(parsedEvents) ? parsedEvents : [];
  const selectedRequest = rawRequests.map((item) => record(item)).find((item) => item.selectionStatus === "SELECTED");
  const destinationHospitalId = optionalString(meta.destinationHospitalId) ?? summary?.destinationHospitalId;
  const destinationRequestId = optionalString(selectedRequest?.requestId)
    ?? hospitalRequests.find((request) => destinationHospitalId && request.hospitalId === destinationHospitalId && request.status === "ACCEPTED")?.id
    ?? null;
  const confirmedEntries = Object.values(facts).map(record);
  const confirmedAt = confirmedEntries.map((entry) => optionalString(entry.confirmedAt)).filter((item): item is string => Boolean(item)).sort().at(-1) ?? now();
  const reportTime = meta.reportTime ?? summary?.reportTime;
  const reportSummary = optionalString(meta.reportSummary) ?? summary?.reportSummary ?? fallback.reportSummary;
  const agency = optionalString(meta.agency) ?? summary?.agency;
  const unitId = optionalString(meta.unitId) ?? summary?.unitId;
  const sceneLatitude = optionalNumber(meta.sceneLatitude) ?? summary?.sceneLatitude ?? fallback.scene.latitude;
  const sceneLongitude = optionalNumber(meta.sceneLongitude) ?? summary?.sceneLongitude ?? fallback.scene.longitude;
  return {
    id: snapshot.caseId,
    code: `EMS Relay-${snapshot.caseId.match(/(\d+)$/)?.[1] ?? snapshot.caseId}`,
    stage: stageFromServer(snapshot.stage, assessment),
    reportTime: displayTime(reportTime, fallback.reportTime),
    reportSummary,
    reportDetail: optionalString(meta.reportDetail) ?? summary?.reportDetail ?? fallback.reportDetail,
    estimatedAge: optionalString(meta.estimatedAge) ?? summary?.estimatedAge ?? fallback.estimatedAge,
    estimatedSex: optionalString(meta.estimatedSex) ?? summary?.estimatedSex ?? fallback.estimatedSex,
    reporter: optionalString(meta.reporter) ?? summary?.reporter ?? fallback.reporter,
    dispatchUnit: [agency, unitId].filter(Boolean).join(" · ") || fallback.dispatchUnit,
    station: optionalString(meta.station) ?? summary?.station ?? fallback.station,
    sceneAddress: optionalString(meta.sceneAddress) ?? summary?.sceneAddress ?? fallback.sceneAddress,
    scene: { latitude: sceneLatitude, longitude: sceneLongitude },
    assessment,
    patientCard: assessmentComplete(assessment) ? { ...assessment, cpss: cpssScore(assessment), confirmedAt, confirmedBy: "paramedic" } : null,
    destinationRequestId,
    timeline: timelineFromEvents(events),
    version: snapshot.version,
    hospitalRequests,
  };
}

type AppSyncSubscriptionSpec = {
  id: string;
  field: "onCaseUpdate" | "onHospitalInbox";
  query: string;
  variables: Record<string, string>;
};

type AppSyncRealtimeMessage = {
  id?: string;
  type?: string;
  payload?: {
    connectionTimeoutMs?: number;
    data?: Record<string, unknown>;
  };
};

function base64UrlJson(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function realtimeEndpointFor(endpoint: string, configured?: string) {
  if (configured?.trim()) return configured.trim();
  const url = new URL(endpoint);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hostname = url.hostname.replace(".appsync-api.", ".appsync-realtime-api.");
  return url.toString();
}

function subscriptionSpecs(scope: V2RealtimeScope): AppSyncSubscriptionSpec[] {
  if (scope.role === "hospital") {
    return [{
      id: crypto.randomUUID(),
      field: "onHospitalInbox",
      query: `subscription OnHospitalInbox($hospitalId: ID!) { onHospitalInbox(hospitalId: $hospitalId) { ${CASE_UPDATE_FIELDS} } }`,
      variables: { hospitalId: scope.hospitalId },
    }];
  }
  return [...new Set(scope.caseIds.filter(Boolean))].map((caseId) => ({
    id: crypto.randomUUID(),
    field: "onCaseUpdate" as const,
    query: `subscription OnCaseUpdate($caseId: ID!) { onCaseUpdate(caseId: $caseId) { ${CASE_UPDATE_FIELDS} } }`,
    variables: { caseId },
  }));
}

function caseUpdateFrom(value: unknown): V2CaseUpdate | null {
  const raw = record(value);
  if (
    typeof raw.caseId !== "string"
    || typeof raw.version !== "number"
    || typeof raw.eventId !== "string"
    || typeof raw.eventType !== "string"
    || typeof raw.stage !== "string"
    || typeof raw.occurredAt !== "string"
  ) return null;
  return {
    caseId: raw.caseId,
    version: raw.version,
    eventId: raw.eventId,
    eventType: raw.eventType,
    stage: raw.stage,
    occurredAt: raw.occurredAt,
    requestId: optionalString(raw.requestId),
    hospitalId: optionalString(raw.hospitalId),
    requestStatus: optionalString(raw.requestStatus),
    payload: raw.payload,
  };
}

export class GraphQLEmsV2Api implements EmsV2Api {
  private listeners = new Set<V2StoreListener>();
  private fetchImpl: typeof fetch;
  private matchingRoots = new Map<string, string>();

  constructor(private readonly options: GraphQLAdapterOptions) {
    // Browser fetch requires Window/globalThis as its receiver. Storing the
    // native function and later calling it as a class member causes
    // `Illegal invocation` in Chromium even though Node-based tests pass.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  subscribe(listener: V2StoreListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watchUpdates(
    scope: V2RealtimeScope,
    listener: (update: V2CaseUpdate) => void,
    onStatus?: (status: V2RealtimeStatus) => void,
  ) {
    const specs = subscriptionSpecs(scope);
    if (!specs.length || typeof window === "undefined") {
      onStatus?.("disconnected");
      return () => undefined;
    }

    const endpoint = realtimeEndpointFor(this.options.endpoint, this.options.realtimeEndpoint);
    const apiHost = new URL(this.options.endpoint).host;
    const createSocket = this.options.webSocketFactory
      ?? ((url: string, protocols: string[]) => new WebSocket(url, protocols) as unknown as AppSyncWebSocket);
    const reconnectBaseMs = Math.max(100, this.options.reconnectBaseMs ?? 1_000);
    const reconnectMaxMs = Math.max(reconnectBaseMs, this.options.reconnectMaxMs ?? 30_000);
    let stopped = false;
    let socket: AppSyncWebSocket | null = null;
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let reconnectAttempt = 0;
    let connectionTimeoutMs = 300_000;
    let pendingAcks = new Set<string>();

    const reportStatus = (status: V2RealtimeStatus) => {
      if (!stopped) onStatus?.(status);
    };
    const clearWatchdog = () => {
      if (watchdogTimer) globalThis.clearTimeout(watchdogTimer);
      watchdogTimer = null;
    };
    const detachAndClose = (active: AppSyncWebSocket, code = 1012) => {
      active.onopen = null;
      active.onmessage = null;
      active.onerror = null;
      active.onclose = null;
      try { active.close(code, code === 1000 ? "client stop" : "reconnect"); } catch { /* Socket is already closed. */ }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      reportStatus("reconnecting");
      const delay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** reconnectAttempt));
      reconnectAttempt += 1;
      reconnectTimer = globalThis.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };
    const failSocket = (active: AppSyncWebSocket, shouldClose = true) => {
      if (socket !== active) return;
      socket = null;
      pendingAcks.clear();
      clearWatchdog();
      if (shouldClose) detachAndClose(active);
      else {
        active.onopen = null;
        active.onmessage = null;
        active.onerror = null;
        active.onclose = null;
      }
      scheduleReconnect();
    };
    const armWatchdog = (active: AppSyncWebSocket, timeoutMs: number) => {
      clearWatchdog();
      watchdogTimer = globalThis.setTimeout(() => failSocket(active), Math.max(1_000, timeoutMs));
    };

    const connect = async () => {
      if (stopped || socket) return;
      reportStatus(reconnectAttempt ? "reconnecting" : "connecting");
      let token: string | null = null;
      try { token = await this.options.getAccessToken?.() ?? null; } catch { /* Polling remains active while auth refresh recovers. */ }
      if (stopped) return;
      if (!token) {
        reportStatus("disconnected");
        scheduleReconnect();
        return;
      }

      const authorization = { Authorization: token, host: apiHost };
      let active: AppSyncWebSocket;
      try {
        active = createSocket(endpoint, ["graphql-ws", `header-${base64UrlJson(authorization)}`]);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = active;

      active.onopen = () => {
        if (socket !== active || stopped) return;
        armWatchdog(active, 10_000);
        active.send(JSON.stringify({ type: "connection_init" }));
      };
      active.onmessage = (event) => {
        if (socket !== active || stopped || typeof event.data !== "string") return;
        let message: AppSyncRealtimeMessage;
        try { message = JSON.parse(event.data) as AppSyncRealtimeMessage; } catch { return; }

        if (message.type === "connection_ack") {
          pendingAcks = new Set(specs.map((spec) => spec.id));
          connectionTimeoutMs = message.payload?.connectionTimeoutMs ?? 300_000;
          armWatchdog(active, connectionTimeoutMs);
          for (const spec of specs) {
            active.send(JSON.stringify({
              id: spec.id,
              type: "start",
              payload: {
                data: JSON.stringify({ query: spec.query, variables: spec.variables }),
                extensions: { authorization },
              },
            }));
          }
          return;
        }
        if (message.type === "ka") {
          armWatchdog(active, connectionTimeoutMs);
          return;
        }
        if (message.type === "start_ack" && message.id) {
          pendingAcks.delete(message.id);
          if (!pendingAcks.size) {
            reconnectAttempt = 0;
            reportStatus("connected");
          }
          return;
        }
        if (message.type === "data") {
          const value = message.payload?.data?.onCaseUpdate ?? message.payload?.data?.onHospitalInbox;
          const update = caseUpdateFrom(value);
          if (update) listener(update);
          if (pendingAcks.size) {
            pendingAcks.clear();
            reconnectAttempt = 0;
            reportStatus("connected");
          }
          return;
        }
        if (message.type === "error" || message.type === "connection_error" || message.type === "complete") failSocket(active);
      };
      active.onerror = () => failSocket(active);
      active.onclose = () => failSocket(active, false);
    };

    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer) globalThis.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearWatchdog();
      const active = socket;
      socket = null;
      if (!active) return;
      for (const spec of specs) {
        try { active.send(JSON.stringify({ id: spec.id, type: "stop" })); } catch { break; }
      }
      detachAndClose(active, 1000);
    };
  }

  async getStore() {
    const base = createInitialV2Store();
    base.cases = await this.listMyCases();
    base.requests = base.cases.flatMap((incident) => incident.hospitalRequests ?? []);
    for (const request of base.requests) {
      if (!request.hospitalLocation || base.hospitals.some((hospital) => hospital.id === request.hospitalId)) continue;
      base.hospitals.push({
        id: request.hospitalId,
        name: request.hospitalName ?? request.hospitalId,
        address: request.hospitalAddress ?? "주소 정보 확인 중",
        location: request.hospitalLocation,
        capabilities: [],
      });
    }
    base.updatedAt = now();
    return base;
  }

  async listMyCases() {
    const summaries = await this.request<RawCaseSummary[]>(
      `query listMyCases { listMyCases { ${CASE_SUMMARY_FIELDS} } }`,
      {},
      "listMyCases",
    );
    const incidents = await Promise.all(summaries.map(async (summary) => {
      const snapshot = await this.getRawCase(summary.caseId);
      return incidentFromSnapshot(snapshot, summary);
    }));
    return incidents.sort((left, right) => right.reportTime.localeCompare(left.reportTime));
  }

  async getCase(caseId: string) {
    return incidentFromSnapshot(await this.getRawCase(caseId));
  }

  async listHospitals() { return createInitialV2Store().hospitals; }

  async listHospitalInbox(hospitalId: string) {
    const rawItems = await this.request<RawHospitalInboxItem[]>(
      `query listHospitalInbox($hospitalId: ID) { listHospitalInbox(hospitalId: $hospitalId) { ${INBOX_FIELDS} } }`,
      { hospitalId },
      "listHospitalInbox",
    );
    const uniqueCaseIds = [...new Set(rawItems.map((item) => item.caseId))];
    const snapshots = await Promise.allSettled(uniqueCaseIds.map(async (caseId) => [caseId, await this.getCase(caseId)] as const));
    const cases = new Map(snapshots.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    const fixtures = createInitialV2Store();
    return rawItems.map((item) => {
      const incident = cases.get(item.caseId) ?? incidentFromInbox(item, fixtures.cases.find((candidate) => candidate.id === item.caseId));
      const request = hospitalRequestFromRaw({ ...item, selectionStatus: incident.destinationRequestId === item.requestId ? "SELECTED" : undefined })!;
      const hospital = fixtures.hospitals.find((candidate) => candidate.id === item.hospitalId) ?? {
        id: item.hospitalId,
        name: item.hospitalName ?? item.hospitalId,
        address: "기관 주소 정보 확인 중",
        location: incident.scene,
        capabilities: [],
      };
      return { request, incident, hospital };
    }).sort((left, right) => right.request.requestedAt.localeCompare(left.request.requestedAt));
  }

  startDispatch = (caseId: string) => this.commandAndRefresh(caseId, "DISPATCH_STARTED");
  arriveScene = (caseId: string) => this.commandAndRefresh(caseId, "ARRIVED_SCENE");
  contactPatient = (caseId: string) => this.commandAndRefresh(caseId, "PATIENT_CONTACT");

  async saveAssessment(caseId: string, assessment: PatientAssessment) {
    return this.commandAndRefresh(caseId, "SAVE_ASSESSMENT_FACTS", {
      kind: "initial",
      facts: assessmentFacts(assessment),
    });
  }

  async confirmPatientCard(caseId: string) {
    const incident = await this.getCase(caseId);
    if (!incident.patientCard) throw new Error("필수 환자 평가를 모두 확인해 주세요.");
    return incident;
  }

  async startMatching(caseId: string) {
    const incident = await this.getCase(caseId);
    const storedRoot = typeof window !== "undefined" ? window.sessionStorage.getItem(`ems-relay:v2:match-root:${caseId}`) : null;
    const requestId = this.matchingRoots.get(caseId) ?? storedRoot ?? crypto.randomUUID();
    this.matchingRoots.set(caseId, requestId);
    if (typeof window !== "undefined") window.sessionStorage.setItem(`ems-relay:v2:match-root:${caseId}`, requestId);
    await this.request<MatchingJob>(
      `mutation requestHospitalMatching($input: HospitalMatchingInput!) { requestHospitalMatching(input: $input) { ${MATCHING_JOB_FIELDS} } }`,
      { input: { caseId, requestId, latitude: incident.scene.latitude, longitude: incident.scene.longitude, radiusKm: 15, maxRadiusKm: 120 } },
      "requestHospitalMatching",
    );
  }

  async markRequestViewed(caseId: string, requestId: string, hospitalId: string) {
    await this.executeCommand(caseId, "HOSPITAL_REQUEST_VIEWED", { requestId });
    return this.requestFromRefreshedCase(caseId, requestId, hospitalId);
  }

  async respondToRequest(caseId: string, requestId: string, hospitalId: string, decision: HospitalDecision, reason?: string) {
    await this.executeCommand(caseId, "HOSPITAL_RESPONSE_RECORDED", {
      requestId,
      decision,
      ...(reason?.trim() ? { reasonText: reason.trim() } : {}),
    });
    return this.requestFromRefreshedCase(caseId, requestId, hospitalId);
  }

  async selectDestination(caseId: string, requestId: string) {
    const incident = await this.getCase(caseId);
    const request = incident.hospitalRequests?.find((candidate) => candidate.id === requestId);
    if (!request) throw new Error("선택한 병원 요청을 찾을 수 없습니다.");
    return this.commandAndRefresh(caseId, "DESTINATION_CONFIRMED_BY_PARAMEDIC", { requestId, hospitalId: request.hospitalId });
  }

  startTransport = (caseId: string) => this.commandAndRefresh(caseId, "TRANSPORT_STARTED");
  arriveHospital = (caseId: string) => this.commandAndRefresh(caseId, "ARRIVED_HOSPITAL");

  createTranscribeSession(caseId: string) {
    return this.request<TranscribeSession>(
      `mutation createTranscribeSession($input: TranscribeSessionInput!) { createTranscribeSession(input: $input) { sessionId websocketUrl expiresAt languageCode mediaEncoding sampleRateHertz } }`,
      { input: { caseId } },
      "createTranscribeSession",
    );
  }

  async structureVoiceUpdate(caseId: string, transcript: string, focus: VoiceUpdateFocus = "VITALS") {
    const raw = await this.request<RawVoiceProposal>(
      `mutation structureVoiceUpdate($input: VoiceProposalInput!) { structureVoiceUpdate(input: $input) { proposalId caseId baseVersion status summary changes flags createdAt requiresHumanReview } }`,
      { input: { caseId, transcript, focus, observedAt: new Date().toISOString() } },
      "structureVoiceUpdate",
      15_000,
    );
    if (raw.status !== "PENDING" || raw.requiresHumanReview !== true) throw new Error("음성 변경안의 검토 상태를 확인할 수 없습니다.");
    return {
      ...raw,
      status: "PENDING" as const,
      requiresHumanReview: true as const,
      changes: parseJson<VoiceProposalChange[]>(raw.changes, []),
      flags: parseJson<VoiceProposal["flags"]>(raw.flags, []),
    };
  }

  resetDemoCases(confirmation: string) {
    return this.request<DemoResetResult>(
      `mutation resetDemoCases($input: DemoResetInput!) { resetDemoCases(input: $input) { caseIds deletedItems restoredItems resetAt } }`,
      { input: { confirmation } },
      "resetDemoCases",
    );
  }

  private getRawCase(caseId: string) {
    return this.request<RawCaseSnapshot>(
      `query getCase($caseId: ID!) { getCase(caseId: $caseId) { ${CASE_SNAPSHOT_FIELDS} } }`,
      { caseId },
      "getCase",
    );
  }

  private async executeCommand(caseId: string, type: string, payload: Record<string, unknown> = {}, expectedVersion?: number) {
    const input = {
      commandId: crypto.randomUUID(),
      caseId,
      type,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      payload: JSON.stringify(payload),
    };
    return this.request<Record<string, unknown>>(
      `mutation executeCommand($input: ExecuteCommandInput!) { executeCommand(input: $input) { ${CASE_UPDATE_FIELDS} } }`,
      { input },
      "executeCommand",
    );
  }

  private async commandAndRefresh(caseId: string, type: string, payload: Record<string, unknown> = {}, expectedVersion?: number) {
    await this.executeCommand(caseId, type, payload, expectedVersion);
    return this.getCase(caseId);
  }

  private async requestFromRefreshedCase(caseId: string, requestId: string, hospitalId: string) {
    const incident = await this.getCase(caseId);
    const request = incident.hospitalRequests?.find((candidate) => candidate.id === requestId && candidate.hospitalId === hospitalId);
    if (!request) throw new Error("갱신된 병원 요청을 찾을 수 없습니다.");
    return request;
  }

  private async request<T>(query: string, variables: Record<string, unknown>, operationName: string, timeoutMs = 12_000) {
    const tokenLookup = this.options.getAccessToken?.();
    let token: string | null | undefined;
    if (tokenLookup) {
      let tokenTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
      try {
        token = await Promise.race([
          tokenLookup,
          new Promise<never>((_, reject) => {
            tokenTimer = globalThis.setTimeout(
              () => reject(new Error("로그인 토큰 확인 시간이 초과되었습니다. 다시 로그인해 주세요.")),
              5_000,
            );
          }),
        ]);
      } finally {
        if (tokenTimer) globalThis.clearTimeout(tokenTimer);
      }
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: token } : {}),
        },
        body: JSON.stringify({ query, variables, operationName }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("서버 응답 시간이 초과되었습니다. 네트워크 연결을 확인해 주세요.");
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
    const payload = await response.json() as { data?: Record<string, T | null>; errors?: Array<{ message: string }> };
    if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message ?? "서버 요청을 처리하지 못했습니다.");
    const value = payload.data?.[operationName];
    if (value === undefined || value === null) throw new Error("서버 응답이 비어 있습니다.");
    return value;
  }
}

function incidentFromInbox(item: RawHospitalInboxItem, fallback?: DispatchCase): DispatchCase {
  const base = fallback ?? createInitialV2Store().cases[0];
  const facts = parseJson<Record<string, unknown>>(item.patientCard, {});
  const assessment = assessmentFromFacts(facts);
  return {
    ...structuredClone(base),
    id: item.caseId,
    code: `EMS Relay-${item.caseId.match(/(\d+)$/)?.[1] ?? item.caseId}`,
    stage: "matching",
    assessment,
    patientCard: assessmentComplete(assessment) ? { ...assessment, cpss: cpssScore(assessment), confirmedAt: item.updatedAt, confirmedBy: "paramedic" } : null,
    destinationRequestId: null,
    hospitalRequests: [hospitalRequestFromRaw(item)!],
  };
}

let injectedApi: EmsV2Api | null = null;

export function injectV2Api(api: EmsV2Api | null) { injectedApi = api; }

export function getV2Api() {
  if (injectedApi) return injectedApi;
  const remote = process.env.NEXT_PUBLIC_EMS_DATA_MODE === "remote";
  const endpoint = process.env.NEXT_PUBLIC_EMS_V2_GRAPHQL_URL?.trim();
  if (remote && !endpoint) throw new Error("NEXT_PUBLIC_EMS_V2_GRAPHQL_URL 설정이 필요합니다.");
  injectedApi = remote && endpoint ? new GraphQLEmsV2Api({
    endpoint,
    realtimeEndpoint: process.env.NEXT_PUBLIC_EMS_V2_GRAPHQL_REALTIME_URL?.trim(),
    getAccessToken: currentAccessToken,
  }) : new LocalEmsV2Api();
  return injectedApi;
}

function assessmentFacts(assessment: PatientAssessment) {
  const measuredAt = assessment.measuredAt?.match(/^(\d{2}):(\d{2})$/);
  const observedDate = new Date();
  if (measuredAt) observedDate.setHours(Number(measuredAt[1]), Number(measuredAt[2]), 0, 0);
  const observedAt = observedDate.toISOString();
  const sideValue = (value: StrokeSide | undefined) => ({ normal: "정상", left: "좌측 이상", right: "우측 이상", unassessable: "평가 불가" } as const)[value ?? "normal"];
  const speechValue = (value: SpeechFinding | undefined) => ({ normal: "정상", dysarthria: "구음장애", aphasia: "실어증", unassessable: "평가 불가" } as const)[value ?? "normal"];
  const entries: Array<[string, unknown]> = [
    ["patient.age", assessment.age],
    ["patient.sex", assessment.sex === "female" ? "여성" : assessment.sex === "male" ? "남성" : "미상"],
    ["assessment.airway", assessment.airway === "patent" ? "개방" : "확보 필요"],
    ["assessment.breathing", assessment.breathing === "adequate" ? "자발호흡" : "호흡 이상"],
    ["assessment.circulation", assessment.circulation === "stable" ? "맥박 촉지" : "순환 불안정"],
    ["consciousness.avpu", assessment.avpu],
    ["symptoms.chiefComplaint", assessment.chiefComplaint],
    ["assessment.cpss.face", sideValue(assessment.face)],
    ["assessment.cpss.arm", sideValue(assessment.arm)],
    ["assessment.cpss.speech", speechValue(assessment.speech)],
    ["assessment.cpss.score", cpssScore(assessment)],
    ["symptoms.lastKnownNormalAt", assessment.lastKnownWell],
    ["symptoms.lastKnownNormalBasis", assessment.lastKnownWellBasis],
    ["symptoms.firstAbnormalAt", assessment.firstAbnormalTime],
    ["vitals.systolicBp", assessment.systolicBp],
    ["vitals.diastolicBp", assessment.diastolicBp],
    ["vitals.pulse", assessment.pulse],
    ["vitals.respiratoryRate", assessment.respiratoryRate],
    ["vitals.spo2", assessment.spo2],
    ["vitals.glucose", assessment.glucose],
    ["vitals.temperature", assessment.temperature],
  ];
  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([path, value]) => ({ path, value, observedAt, sourceText: `구급대원 직접 확인: ${path}` }));
}
