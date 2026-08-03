import { createHash } from "node:crypto";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { AuthorizationError } from "./auth.js";
import { StoreConflictError, StoreNotFoundError } from "./store.js";
import type { AmbulanceActivityReport, AuthPrincipal } from "./types.js";
import { getLatestReport } from "./reportStore.js";
import { appendInternalEvent, assertCaseAccess } from "./workflowStore.js";

const REGION = process.env.HEALTHLAKE_REGION || process.env.AWS_REGION || "us-west-2";
const DATASTORE_ENDPOINT = process.env.HEALTHLAKE_DATASTORE_ENDPOINT?.replace(/\/$/, "") ?? "";
const signer = new SignatureV4({ credentials: defaultProvider(), region: REGION, service: "healthlake", sha256: Hash.bind(null, "sha256") });

type FhirResource = Record<string, unknown> & { resourceType: string; id: string };
type BundleEntry = { fullUrl: string; resource: FhirResource; request: { method: "PUT"; url: string } };

function stableId(type: string, value: string) {
  return `${type.toLowerCase()}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function valueNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function observation(
  caseId: string,
  patientId: string,
  encounterId: string,
  suffix: string,
  code: string,
  display: string,
  value: unknown,
  unit: string,
  unitCode: string,
  effectiveDateTime?: string,
): FhirResource | undefined {
  const number = valueNumber(value);
  if (number === undefined) return undefined;
  return {
    resourceType: "Observation",
    id: stableId("obs", `${caseId}-${suffix}`),
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
    code: { coding: [{ system: "http://loinc.org", code, display }] },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    ...(effectiveDateTime ? { effectiveDateTime } : {}),
    valueQuantity: { value: number, unit, system: "http://unitsofmeasure.org", code: unitCode },
  };
}

function toEntry(resource: FhirResource): BundleEntry {
  return {
    fullUrl: `${resource.resourceType}/${resource.id}`,
    resource,
    request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` },
  };
}

export function mapFinalizedReportToFhir(report: AmbulanceActivityReport) {
  if (report.status !== "FINALIZED") throw new StoreConflictError("사람이 최종 확정한 보고서만 FHIR로 변환할 수 있습니다.");
  const patientId = stableId("patient", report.caseId);
  const encounterId = stableId("encounter", report.caseId);
  const vitals = report.draft.patientAssessment.vitalSigns[0] ?? {};
  const measuredAt = typeof vitals.measuredAt === "string" ? vitals.measuredAt : undefined;
  const sex = report.draft.patientIdentity.sex;
  const patient: FhirResource = {
    resourceType: "Patient",
    id: patientId,
    identifier: [{ system: "https://ems-relay.local/case-patient", value: report.caseId }],
    ...(sex === "남" || sex === "남성" ? { gender: "male" } : sex === "여" || sex === "여성" ? { gender: "female" } : { gender: "unknown" }),
  };
  const encounter: FhirResource = {
    resourceType: "Encounter",
    id: encounterId,
    identifier: [{ system: "https://ems-relay.local/case", value: report.caseId }],
    status: "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER", display: "emergency" },
    subject: { reference: `Patient/${patientId}` },
    period: {
      start: report.draft.dispatchTimeline.patientContactAt ?? report.draft.dispatchTimeline.dispatchStartedAt,
      end: report.draft.dispatchTimeline.handoffAcceptedAt ?? report.finalizedAt,
    },
  };
  const observations = [
    observation(report.caseId, patientId, encounterId, "sbp", "8480-6", "Systolic blood pressure", vitals.systolicBp, "mmHg", "mm[Hg]", measuredAt),
    observation(report.caseId, patientId, encounterId, "dbp", "8462-4", "Diastolic blood pressure", vitals.diastolicBp, "mmHg", "mm[Hg]", measuredAt),
    observation(report.caseId, patientId, encounterId, "pulse", "8867-4", "Heart rate", vitals.pulse, "beats/min", "/min", measuredAt),
    observation(report.caseId, patientId, encounterId, "rr", "9279-1", "Respiratory rate", vitals.respiratoryRate, "breaths/min", "/min", measuredAt),
    observation(report.caseId, patientId, encounterId, "spo2", "2708-6", "Oxygen saturation", vitals.spo2, "%", "%", measuredAt),
    observation(report.caseId, patientId, encounterId, "temp", "8310-5", "Body temperature", vitals.temperature, "°C", "Cel", measuredAt),
    observation(report.caseId, patientId, encounterId, "glucose", "2339-0", "Glucose", vitals.glucose, "mg/dL", "mg/dL", measuredAt),
  ].filter((resource): resource is FhirResource => resource !== undefined);

  const resources: FhirResource[] = [patient, encounter, ...observations];
  const impression = report.draft.paramedicAssessment.fieldImpression;
  if (typeof impression === "string" && impression.trim()) {
    resources.push({
      resourceType: "ClinicalImpression",
      id: stableId("impression", report.caseId),
      status: "completed",
      subject: { reference: `Patient/${patientId}` },
      encounter: { reference: `Encounter/${encounterId}` },
      description: impression,
      note: [{ text: "현장 구급대원 평가이며 확정 진단이 아닙니다." }],
    });
  }
  const medications = report.draft.paramedicAssessment.medications;
  if (typeof medications === "string" || Array.isArray(medications)) {
    resources.push({
      resourceType: "MedicationStatement",
      id: stableId("medication", report.caseId),
      status: "unknown",
      subject: { reference: `Patient/${patientId}` },
      medicationCodeableConcept: { text: Array.isArray(medications) ? medications.join(", ") : medications },
    });
  }
  const procedures = report.draft.emergencyCare.procedures;
  if (typeof procedures === "string" || Array.isArray(procedures)) {
    resources.push({
      resourceType: "Procedure",
      id: stableId("procedure", report.caseId),
      status: "completed",
      subject: { reference: `Patient/${patientId}` },
      encounter: { reference: `Encounter/${encounterId}` },
      code: { text: Array.isArray(procedures) ? procedures.join(", ") : procedures },
    });
  }
  const provenanceId = stableId("provenance", report.caseId);
  resources.push({
    resourceType: "Provenance",
    id: provenanceId,
    recorded: report.finalizedAt ?? report.updatedAt,
    target: resources.map((resource) => ({ reference: `${resource.resourceType}/${resource.id}` })),
    agent: [{ who: { identifier: { system: "https://ems-relay.local/cognito-sub", value: report.finalizedBy } }, type: { text: "human reviewer" } }],
    entity: [{ role: "source", what: { identifier: { system: "https://ems-relay.local/report", value: report.reportId } } }],
  });

  return {
    resourceType: "Bundle",
    type: "transaction",
    timestamp: new Date().toISOString(),
    entry: resources.map(toEntry),
  };
}

async function postSignedBundle(bundle: ReturnType<typeof mapFinalizedReportToFhir>) {
  if (!DATASTORE_ENDPOINT) throw new Error("HEALTHLAKE_NOT_CONFIGURED");
  const url = new URL(DATASTORE_ENDPOINT);
  const body = JSON.stringify(bundle);
  const request = new HttpRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    method: "POST",
    path: url.pathname,
    headers: { host: url.host, "content-type": "application/fhir+json", accept: "application/fhir+json" },
    body,
  });
  const signed = await signer.sign(request);
  const response = await fetch(DATASTORE_ENDPOINT, { method: "POST", headers: signed.headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`HEALTHLAKE_${response.status}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) as unknown : {};
}

async function publishReport(caseId: string, actorSub: string, actorRole: "paramedic" | "admin") {
  const report = await getLatestReport(caseId);
  if (!report) throw new StoreNotFoundError("보고서를 찾을 수 없습니다.");
  const bundle = mapFinalizedReportToFhir(report);
  const result = await postSignedBundle(bundle);
  await appendInternalEvent(caseId, "FHIR_PUBLISHED", actorSub, actorRole, { reportId: report.reportId, bundleEntries: bundle.entry.length }, `fhir-published-${report.reportId}-v${report.version}`);
  return { reportId: report.reportId, bundleEntries: bundle.entry.length, result };
}

export async function publishFinalizedReportForOutbox(caseId: string, actorSub: string, actorRole: "paramedic" | "admin") {
  return publishReport(caseId, actorSub, actorRole);
}

export async function publishFinalizedReport(caseId: string, principal: AuthPrincipal) {
  if (!principal.roles.includes("paramedic") && !principal.roles.includes("admin")) throw new AuthorizationError();
  await assertCaseAccess(principal, caseId);
  return publishReport(caseId, principal.sub, principal.roles.includes("admin") ? "admin" : "paramedic");
}
