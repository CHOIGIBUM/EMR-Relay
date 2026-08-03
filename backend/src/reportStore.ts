import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizationError } from "./auth.js";
import { getCase, StoreConflictError, StoreNotFoundError } from "./store.js";
import type { AmbulanceActivityReport, Annex5ReportDraft, AuthPrincipal, FactPath } from "./types.js";
import { appendInternalEvent, assertCaseAccess, getWorkflowCase } from "./workflowStore.js";

const TABLE_NAME = process.env.TABLE_NAME || "ems-relay-local";
const REPORT_BUCKET = process.env.REPORT_BUCKET || "";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const REPORT_SK = "REPORT#LATEST";
const FHIR_AUTO_PUBLISH_ENABLED = Boolean(process.env.HEALTHLAKE_DATASTORE_ENDPOINT?.trim());

export const REQUIRED_REPORT_REVIEW_FIELDS = [
  "patientIdentity",
  "symptomsAndOccurrence",
  "patientAssessment",
  "paramedicAssessment",
  "emergencyCare",
  "medicalDirection",
  "transport",
  "handoff",
] as const;

function factValue(facts: Awaited<ReturnType<typeof getCase>>["confirmedState"]["facts"], path: FactPath) {
  return facts[path]?.value;
}

function eventTime(events: Awaited<ReturnType<typeof getWorkflowCase>>["events"], type: string) {
  return events.find((event) => event.type === type)?.occurredAt;
}

function present(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

export async function buildAnnex5Draft(caseId: string): Promise<Annex5ReportDraft> {
  const [base, workflow] = await Promise.all([getCase(caseId), getWorkflowCase(caseId)]);
  if (!workflow.meta) throw new StoreNotFoundError("사건을 찾을 수 없습니다.");
  if (!(["HANDOFF", "COMPLETE"] as const).includes(workflow.meta.stage as "HANDOFF" | "COMPLETE")) {
    throw new StoreConflictError("병원 인계 단계 이후에 구급활동일지 초안을 생성할 수 있습니다.");
  }
  const facts = base.confirmedState.facts;
  const destination = workflow.hospitalRequests.find((request) => request.hospitalId === workflow.meta?.destinationHospitalId);
  const assignedEvent = workflow.events.find((event) => event.type === "CASE_ASSIGNED");
  const reportedAt = typeof assignedEvent?.payload.reportedAt === "string" ? assignedEvent.payload.reportedAt : undefined;
  const dispatchStartedAt = eventTime(workflow.events, "DISPATCH_STARTED");
  const arrivedSceneAt = eventTime(workflow.events, "ARRIVED_SCENE");
  const patientContactAt = eventTime(workflow.events, "PATIENT_CONTACT");
  const transportStartedAt = eventTime(workflow.events, "TRANSPORT_STARTED");
  const arrivedHospitalAt = eventTime(workflow.events, "ARRIVED_HOSPITAL");
  const handoffAcceptedAt = eventTime(workflow.events, "HANDOFF_ACCEPTED");
  const handoffEvent = [...workflow.events].reverse().find((event) => event.type === "HANDOFF_ACCEPTED" || event.type === "HANDOFF_SENT");
  const handoffReceiver = typeof handoffEvent?.payload.receiver === "string" ? handoffEvent.payload.receiver.trim() : "";
  const handoffRole = typeof handoffEvent?.payload.role === "string" ? handoffEvent.payload.role.trim() : "";
  const draft: Annex5ReportDraft = {
    schema: "KR_AMBULANCE_ACTIVITY_ANNEX5_MVP_V1",
    generatedAt: new Date().toISOString(),
    administrative: {
      ...(workflow.meta.agency ? { organization: workflow.meta.agency } : {}),
      ...(workflow.meta.vehicleNumber ? { vehicleNumber: workflow.meta.vehicleNumber } : {}),
      ...(workflow.meta.unitId ? { documentNumber: workflow.meta.unitId } : {}),
      approvals: {},
    },
    dispatchTimeline: {
      caseId,
      ...(reportedAt ? { reportedAt } : {}),
      ...(dispatchStartedAt ? { dispatchStartedAt } : {}),
      ...(arrivedSceneAt ? { arrivedSceneAt } : {}),
      ...(patientContactAt ? { patientContactAt } : {}),
      ...(transportStartedAt ? { transportStartedAt } : {}),
      ...(arrivedHospitalAt ? { arrivedHospitalAt } : {}),
      ...(handoffAcceptedAt ? { handoffAcceptedAt } : {}),
    },
    patientIdentity: {
      age: factValue(facts, "patient.age"),
      sex: factValue(facts, "patient.sex"),
    },
    symptomsAndOccurrence: {
      chiefComplaint: factValue(facts, "symptoms.chiefComplaint"),
      onsetAt: factValue(facts, "symptoms.onsetAt"),
      chestPain: factValue(facts, "symptoms.chestPain"),
      associatedSymptoms: factValue(facts, "symptoms.associated"),
    },
    patientAssessment: {
      consciousness: { avpu: factValue(facts, "consciousness.avpu") },
      pupils: {},
      vitalSigns: [
        {
          sequence: 1,
          measuredAt: facts["vitals.systolicBp"]?.observedAt ?? facts["vitals.pulse"]?.observedAt,
          systolicBp: factValue(facts, "vitals.systolicBp"),
          diastolicBp: factValue(facts, "vitals.diastolicBp"),
          pulse: factValue(facts, "vitals.pulse"),
          respiratoryRate: factValue(facts, "vitals.respiratoryRate"),
          spo2: factValue(facts, "vitals.spo2"),
          temperature: factValue(facts, "vitals.temperature"),
          glucose: factValue(facts, "vitals.glucose"),
        },
        {
          sequence: 2,
          measuredAt: facts["reassessment.systolicBp"]?.observedAt ?? facts["transport.reassessment"]?.observedAt,
          systolicBp: factValue(facts, "reassessment.systolicBp"),
          diastolicBp: factValue(facts, "reassessment.diastolicBp"),
          pulse: factValue(facts, "reassessment.pulse"),
          respiratoryRate: factValue(facts, "reassessment.respiratoryRate"),
          spo2: factValue(facts, "reassessment.spo2"),
          temperature: factValue(facts, "reassessment.temperature"),
          glucose: factValue(facts, "reassessment.glucose"),
          avpu: factValue(facts, "reassessment.avpu"),
          reassessment: factValue(facts, "transport.reassessment"),
        },
      ],
      severityLevel: {},
    },
    paramedicAssessment: {
      fieldImpression: factValue(facts, "assessment.fieldImpression"),
      ecg: factValue(facts, "assessment.ecg"),
      chiefComplaint: factValue(facts, "symptoms.chiefComplaint"),
      onsetAt: factValue(facts, "symptoms.onsetAt"),
      conditions: factValue(facts, "history.conditions"),
      medications: factValue(facts, "history.medications"),
      allergies: factValue(facts, "history.allergies"),
    },
    emergencyCare: {
      oxygen: factValue(facts, "treatment.oxygen"),
      medications: factValue(facts, "treatment.medications"),
      procedures: factValue(facts, "treatment.procedures"),
    },
    medicalDirection: {},
    transport: {
      primaryDestinationHospitalId: workflow.meta.destinationHospitalId,
      primaryDestinationHospitalName: destination?.hospitalName,
      acceptanceResponseAt: destination?.response?.respondedAt,
      retransport: false,
      retransportReason: null,
    },
    handoff: {
      sentAt: eventTime(workflow.events, "HANDOFF_SENT"),
      acceptedAt: eventTime(workflow.events, "HANDOFF_ACCEPTED"),
      ...(handoffReceiver ? { receiverName: handoffReceiver } : {}),
      ...(handoffRole ? { receiverRole: handoffRole } : {}),
    },
    mutualAidAndNonTransport: {
      mutualAid: null,
      nonTransport: false,
      nonTransportReason: null,
    },
    crewAndBarriers: {
      assignedParamedicIds: workflow.meta.assignedParamedicIds,
      barriers: [],
    },
    missingFields: [],
  };
  const mandatory: Array<[string, unknown]> = [
    ["administrative.organization", draft.administrative.organization],
    ["administrative.vehicleNumber", draft.administrative.vehicleNumber],
    ["administrative.documentNumber", draft.administrative.documentNumber],
    ["dispatchTimeline.reportedAt", draft.dispatchTimeline.reportedAt],
    ["dispatchTimeline.dispatchStartedAt", draft.dispatchTimeline.dispatchStartedAt],
    ["dispatchTimeline.arrivedSceneAt", draft.dispatchTimeline.arrivedSceneAt],
    ["dispatchTimeline.patientContactAt", draft.dispatchTimeline.patientContactAt],
    ["dispatchTimeline.transportStartedAt", draft.dispatchTimeline.transportStartedAt],
    ["dispatchTimeline.arrivedHospitalAt", draft.dispatchTimeline.arrivedHospitalAt],
    ["patientIdentity.age", draft.patientIdentity.age],
    ["patientIdentity.sex", draft.patientIdentity.sex],
    ["symptomsAndOccurrence.chiefComplaint", draft.symptomsAndOccurrence.chiefComplaint],
    ["symptomsAndOccurrence.onsetAt", draft.symptomsAndOccurrence.onsetAt],
    ["patientAssessment.consciousness.avpu", draft.patientAssessment.consciousness.avpu],
    ["patientAssessment.vitalSigns[0].measuredAt", draft.patientAssessment.vitalSigns[0]?.measuredAt],
    ["patientAssessment.vitalSigns[0].systolicBp", draft.patientAssessment.vitalSigns[0]?.systolicBp],
    ["patientAssessment.vitalSigns[0].diastolicBp", draft.patientAssessment.vitalSigns[0]?.diastolicBp],
    ["patientAssessment.vitalSigns[0].pulse", draft.patientAssessment.vitalSigns[0]?.pulse],
    ["patientAssessment.vitalSigns[0].respiratoryRate", draft.patientAssessment.vitalSigns[0]?.respiratoryRate],
    ["patientAssessment.vitalSigns[0].spo2", draft.patientAssessment.vitalSigns[0]?.spo2],
    ["transport.primaryDestinationHospitalId", draft.transport.primaryDestinationHospitalId],
    ["handoff.acceptedAt", draft.handoff.acceptedAt],
    ["handoff.receiverName", draft.handoff.receiverName],
    ["handoff.receiverRole", draft.handoff.receiverRole],
    ["crewAndBarriers.assignedParamedicIds", draft.crewAndBarriers.assignedParamedicIds],
  ];
  draft.missingFields = mandatory.filter(([, value]) => !present(value)).map(([path]) => path);
  return draft;
}

function reportFromItem(item: Record<string, unknown> | undefined): AmbulanceActivityReport | undefined {
  if (!item || item.entityType !== "AMBULANCE_ACTIVITY_REPORT") return undefined;
  const { PK: _pk, SK: _sk, entityType: _entityType, ...report } = item;
  return report as AmbulanceActivityReport;
}

export async function getLatestReport(caseId: string) {
  const response = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `CASE#${caseId}`, SK: REPORT_SK },
    ConsistentRead: true,
  }));
  return reportFromItem(response.Item);
}

export async function createReportDraft(caseId: string, principal: AuthPrincipal) {
  if (!principal.roles.includes("paramedic") && !principal.roles.includes("admin")) throw new AuthorizationError();
  await assertCaseAccess(principal, caseId);
  const existing = await getLatestReport(caseId);
  if (existing?.status === "FINALIZED") throw new StoreConflictError("최종 확정된 보고서는 다시 생성할 수 없습니다.");
  const now = new Date().toISOString();
  const report: AmbulanceActivityReport = {
    reportId: existing?.reportId ?? randomUUID(),
    caseId,
    version: (existing?.version ?? 0) + 1,
    status: "DRAFT",
    draft: await buildAnnex5Draft(caseId),
    reviewedFields: [],
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? principal.sub,
    updatedAt: now,
  };
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `CASE#${caseId}`, SK: REPORT_SK, entityType: "AMBULANCE_ACTIVITY_REPORT", ...report },
    ConditionExpression: existing ? "#version = :expected" : "attribute_not_exists(PK)",
    ...(existing ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expected": existing.version } } : {}),
  }));
  await appendInternalEvent(caseId, "REPORT_DRAFTED", principal.sub, principal.roles.includes("admin") ? "admin" : "paramedic", { reportId: report.reportId, reportVersion: report.version }, `report-drafted-${report.reportId}-v${report.version}`);
  return report;
}

export async function reviewReport(caseId: string, principal: AuthPrincipal, reviewedFields: string[]) {
  if (!principal.roles.includes("paramedic") && !principal.roles.includes("admin")) throw new AuthorizationError();
  await assertCaseAccess(principal, caseId);
  const current = await getLatestReport(caseId);
  if (!current) throw new StoreNotFoundError("보고서 초안을 찾을 수 없습니다.");
  if (current.status === "FINALIZED") throw new StoreConflictError("최종 확정된 보고서는 수정할 수 없습니다.");
  const allowed = new Set<string>(REQUIRED_REPORT_REVIEW_FIELDS);
  if (reviewedFields.some((field) => !allowed.has(field))) throw new StoreConflictError("지원하지 않는 검토 항목이 포함되어 있습니다.");
  const next: AmbulanceActivityReport = {
    ...current,
    version: current.version + 1,
    status: "IN_REVIEW",
    reviewedFields: [...new Set(reviewedFields)],
    updatedAt: new Date().toISOString(),
  };
  await putReportWithVersion(next, current.version);
  await appendInternalEvent(caseId, "REPORT_REVIEWED", principal.sub, principal.roles.includes("admin") ? "admin" : "paramedic", { reportId: next.reportId, reviewedFields: next.reviewedFields }, `report-reviewed-${next.reportId}-v${next.version}`);
  return next;
}

function escapeHtml(value: unknown) {
  return String(value ?? "미상").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function reportValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(reportValue).join(" · ") : "미상";
  if (value && typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>).filter((item) => item !== undefined && item !== null && item !== "");
    return entries.length ? entries.map(reportValue).join(" · ") : "미상";
  }
  return String(value ?? "미상");
}

function reportRow(cells: Array<[string, unknown, number?]>) {
  return `<tr>${cells.map(([label, value, colspan]) => `<th>${escapeHtml(label)}</th><td${colspan ? ` colspan="${colspan}"` : ""}>${escapeHtml(reportValue(value))}</td>`).join("")}</tr>`;
}

export function renderAnnex5Html(report: AmbulanceActivityReport) {
  const draft = report.draft;
  const firstVitals = draft.patientAssessment.vitalSigns[0] ?? {};
  const secondVitals = draft.patientAssessment.vitalSigns[1] ?? {};
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>구급활동일지 ${escapeHtml(report.caseId)}</title><style>
@page{size:A4 portrait;margin:7mm}*{box-sizing:border-box}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#111;font-size:8.5px;margin:0}h1{text-align:center;font-size:24px;letter-spacing:.25em;margin:0 0 4px}.caption{text-align:center;margin:0 0 5px;color:#334155}.meta{display:flex;justify-content:space-between;margin:0 0 4px;font-size:8px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #222;padding:3px 4px;vertical-align:middle;word-break:keep-all}th{width:12%;background:#e5e7eb;font-weight:700}.section th{width:auto;background:#cbd5e1;font-size:9.5px;text-align:left;padding:4px}.wide{height:34px}.sign{height:28px}.footer{margin-top:4px;display:flex;justify-content:space-between;color:#475569}
</style></head><body><div class="meta"><span>119구조·구급에 관한 법률 시행규칙 [별지 제5호서식]</span><span>전자작성본</span></div><h1>구급활동일지</h1><p class="caption">확정 사건기록 기반 · 사건번호 ${escapeHtml(report.caseId)}</p><table><tbody>
<tr class="section"><th colspan="8">기관·차량·결재</th></tr>
${reportRow([["소방기관", draft.administrative.organization], ["차량번호", draft.administrative.vehicleNumber], ["구급대", draft.administrative.documentNumber], ["결재", "담당자 확인", 1]])}
<tr class="section"><th colspan="8">신고·출동 시각</th></tr>
${reportRow([["신고 일시", draft.dispatchTimeline.reportedAt], ["출동 시각", draft.dispatchTimeline.dispatchStartedAt], ["현장 도착", draft.dispatchTimeline.arrivedSceneAt], ["환자 접촉", draft.dispatchTimeline.patientContactAt]])}
${reportRow([["현장 출발", draft.dispatchTimeline.transportStartedAt], ["병원 도착", draft.dispatchTimeline.arrivedHospitalAt], ["귀소 시각", "미상"], ["출동 유형", "정상 출동"]])}
<tr class="section"><th colspan="8">환자 인적사항</th></tr>
${reportRow([["성명", draft.patientIdentity.name], ["나이", draft.patientIdentity.age], ["성별", draft.patientIdentity.sex], ["보호자", draft.patientIdentity.guardian]])}
${reportRow([["주소", draft.patientIdentity.address, 3], ["발생 장소", draft.symptomsAndOccurrence.place, 3]])}
${reportRow([["주호소", draft.symptomsAndOccurrence.chiefComplaint, 3], ["발생 시각", draft.symptomsAndOccurrence.onsetAt, 1]])}
${reportRow([["동반 증상", draft.symptomsAndOccurrence.associatedSymptoms, 3], ["흉통", draft.symptomsAndOccurrence.chestPain, 1]])}
<tr class="section"><th colspan="8">환자평가</th></tr>
${reportRow([["의식상태 1차", draft.patientAssessment.consciousness.avpu], ["의식상태 2차", secondVitals.avpu], ["동공", draft.patientAssessment.pupils], ["환자분류", draft.patientAssessment.severityLevel]])}
${reportRow([["1차 활력", `${reportValue(firstVitals.measuredAt)} · BP ${reportValue(firstVitals.systolicBp)}/${reportValue(firstVitals.diastolicBp)} mmHg · PR ${reportValue(firstVitals.pulse)}회/분 · RR ${reportValue(firstVitals.respiratoryRate)}회/분 · SpO₂ ${reportValue(firstVitals.spo2)}% · BT ${reportValue(firstVitals.temperature)}℃ · BST ${reportValue(firstVitals.glucose)} mg/dL`, 7]])}
${reportRow([["2차 활력", `${reportValue(secondVitals.measuredAt)} · BP ${reportValue(secondVitals.systolicBp)}/${reportValue(secondVitals.diastolicBp)} mmHg · PR ${reportValue(secondVitals.pulse)}회/분 · RR ${reportValue(secondVitals.respiratoryRate)}회/분 · SpO₂ ${reportValue(secondVitals.spo2)}% · BT ${reportValue(secondVitals.temperature)}℃ · BST ${reportValue(secondVitals.glucose)} mg/dL`, 7]])}
<tr class="section"><th colspan="8">응급처치</th></tr>
${reportRow([["평가 소견", draft.paramedicAssessment.fieldImpression, 3], ["발생 시각", draft.paramedicAssessment.onsetAt, 3]])}
${reportRow([["과거력", draft.paramedicAssessment.conditions, 3], ["복용약", draft.paramedicAssessment.medications, 3]])}
${reportRow([["알레르기", draft.paramedicAssessment.allergies, 3], ["심전도", draft.paramedicAssessment.ecg, 3]])}
${reportRow([["산소", draft.emergencyCare.oxygen], ["약물", draft.emergencyCare.medications, 2], ["처치", draft.emergencyCare.procedures, 2]])}
<tr class="section"><th colspan="8">의료지도</th></tr>
${reportRow([["연결 여부", draft.medicalDirection.connected], ["지도기관", draft.medicalDirection.organization], ["지도 의사", draft.medicalDirection.physician], ["지도 내용", draft.medicalDirection.instructions]])}
<tr class="section"><th colspan="8">1·2차 이송</th></tr>
${reportRow([["이송 기관명", draft.transport.primaryDestinationHospitalName, 3], ["도착 시각", draft.dispatchTimeline.arrivedHospitalAt], ["선정자", "구급대원", 1]])}
${reportRow([["수용 회신", draft.transport.acceptanceResponseAt, 3], ["재이송", draft.transport.retransport], ["재이송 사유", draft.transport.retransportReason, 1]])}
<tr class="section"><th colspan="8">인수자·인계</th></tr>
${reportRow([["환자 인수자", draft.handoff.receiverName], ["직종", draft.handoff.receiverRole], ["인계 시각", draft.handoff.acceptedAt], ["인계 상태", "인수 확인"]])}
<tr class="section"><th colspan="8">공동대응·출동인원·장애요인</th></tr>
${reportRow([["공동대응", draft.mutualAidAndNonTransport.mutualAid], ["미이송", draft.mutualAidAndNonTransport.nonTransport], ["출동인원", draft.crewAndBarriers.assignedParamedicIds, 2], ["장애요인", draft.crewAndBarriers.barriers]])}
${reportRow([["담당 확인", "성명·서명", 3], ["최종 확정", report.finalizedAt ?? "확정 전", 3]])}
</tbody></table><div class="footer"><span>본 전자작성본은 원본 별지 제5호서식의 기록 항목 순서를 반영합니다.</span><span>${escapeHtml(report.status)}</span></div></body></html>`;
}

async function putReportWithVersion(report: AmbulanceActivityReport, expectedVersion: number) {
  try {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: `CASE#${report.caseId}`, SK: REPORT_SK, entityType: "AMBULANCE_ACTIVITY_REPORT", ...report },
      ConditionExpression: "#version = :expected",
      ExpressionAttributeNames: { "#version": "version" },
      ExpressionAttributeValues: { ":expected": expectedVersion },
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") throw new StoreConflictError("보고서가 다른 사용자에 의해 갱신되었습니다.");
    throw error;
  }
}

async function putFinalizedReportWithOutbox(report: AmbulanceActivityReport, expectedVersion: number, principal: AuthPrincipal) {
  if (!FHIR_AUTO_PUBLISH_ENABLED) {
    await putReportWithVersion(report, expectedVersion);
    return false;
  }
  const outboxSk = `FHIR_OUTBOX#${report.reportId}#V${report.version}`;
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { PK: `CASE#${report.caseId}`, SK: REPORT_SK, entityType: "AMBULANCE_ACTIVITY_REPORT", ...report },
            ConditionExpression: "#version = :expected",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expected": expectedVersion },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: `CASE#${report.caseId}`,
              SK: outboxSk,
              entityType: "FHIR_OUTBOX",
              caseId: report.caseId,
              reportId: report.reportId,
              reportVersion: report.version,
              status: "PENDING",
              requestedBy: principal.sub,
              actorRole: principal.roles.includes("admin") ? "admin" : "paramedic",
              createdAt: report.finalizedAt ?? report.updatedAt,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") throw new StoreConflictError("보고서가 다른 사용자에 의해 갱신되었습니다.");
    throw error;
  }
}

async function archiveFinalizedReport(report: AmbulanceActivityReport) {
  if (!REPORT_BUCKET) return;
  const prefix = `cases/${encodeURIComponent(report.caseId)}/reports/${report.reportId}/v${report.version}`;
  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: REPORT_BUCKET,
      Key: `${prefix}.json`,
      Body: JSON.stringify(report),
      ContentType: "application/json; charset=utf-8",
      ServerSideEncryption: "AES256",
    })),
    s3.send(new PutObjectCommand({
      Bucket: REPORT_BUCKET,
      Key: `${prefix}.html`,
      Body: renderAnnex5Html(report),
      ContentType: "text/html; charset=utf-8",
      ServerSideEncryption: "AES256",
    })),
  ]);
}

export async function finalizeReport(caseId: string, principal: AuthPrincipal) {
  if (!principal.roles.includes("paramedic") && !principal.roles.includes("admin")) throw new AuthorizationError();
  await assertCaseAccess(principal, caseId);
  const current = await getLatestReport(caseId);
  if (!current) throw new StoreNotFoundError("보고서 초안을 찾을 수 없습니다.");
  if (current.status === "FINALIZED") {
    await archiveFinalizedReport(current);
    await appendInternalEvent(caseId, "REPORT_FINALIZED", principal.sub, principal.roles.includes("admin") ? "admin" : "paramedic", { reportId: current.reportId, reportVersion: current.version }, `report-finalized-${current.reportId}-v${current.version}`);
    return current;
  }
  const missingReview = REQUIRED_REPORT_REVIEW_FIELDS.filter((field) => !current.reviewedFields.includes(field));
  if (missingReview.length) throw new StoreConflictError(`최종 확정 전 검토가 필요한 항목: ${missingReview.join(", ")}`);
  if (current.draft.missingFields.length) {
    throw new StoreConflictError(`최종 확정 전 입력이 필요한 항목: ${current.draft.missingFields.join(", ")}`);
  }
  const finalizedAt = new Date().toISOString();
  const finalized: AmbulanceActivityReport = {
    ...current,
    version: current.version + 1,
    status: "FINALIZED",
    finalizedAt,
    finalizedBy: principal.sub,
    updatedAt: finalizedAt,
  };
  await putFinalizedReportWithOutbox(finalized, current.version, principal);
  await archiveFinalizedReport(finalized);
  await appendInternalEvent(caseId, "REPORT_FINALIZED", principal.sub, principal.roles.includes("admin") ? "admin" : "paramedic", { reportId: finalized.reportId, reportVersion: finalized.version }, `report-finalized-${finalized.reportId}-v${finalized.version}`);
  return finalized;
}
