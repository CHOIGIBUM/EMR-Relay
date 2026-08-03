import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AgentOutputError, createAgentRuntimeSessionId, normalizeAgentCoreResponse } from "../src/agent.js";
import { authorizeCommand, principalFromEvent } from "../src/auth.js";
import { mapFinalizedReportToFhir } from "../src/fhir.js";
import { handler } from "../src/handler.js";
import { renderAnnex5Html, REQUIRED_REPORT_REVIEW_FIELDS } from "../src/reportStore.js";
import { validateDirectFactsRequest } from "../src/schemas.js";
import type { AmbulanceActivityReport, ConfirmedState } from "../src/types.js";
import { validateCaseCommand, validateTranscribeSession } from "../src/workflowSchemas.js";
import { completedInitialAssessmentSteps, missingInitialAssessmentPaths } from "../src/assessmentContract.js";
import { INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP } from "../src/types.js";

function jwtEvent(groups: string, sub = "paramedic-01") {
  return {
    requestContext: {
      authorizer: { jwt: { claims: { sub, "cognito:groups": groups } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

test("derives actor and role only from JWT claims", () => {
  const principal = principalFromEvent(jwtEvent("[paramedic]"));
  assert.equal(principal.sub, "paramedic-01");
  assert.deepEqual(principal.roles, ["paramedic"]);
  assert.doesNotThrow(() => authorizeCommand(principal, "PATIENT_CONTACT"));
  assert.throws(() => authorizeCommand(principal, "HOSPITAL_RESPONSE_RECORDED"));
});

test("does not expose the full activity report to a hospital principal", async () => {
  const path = "/cases/GW-CARDIO-050/report";
  const event = {
    rawPath: path,
    pathParameters: { id: "GW-CARDIO-050" },
    requestContext: {
      http: { method: "GET", path },
      authorizer: { jwt: { claims: { sub: "hospital-user-01", "cognito:groups": "[hospital]", "custom:hospital_id": "hospital-01" } } },
    },
  } as unknown as APIGatewayProxyEventV2;
  const result = await handler(event, { awsRequestId: "report-access-test" } as Context);
  assert.equal(typeof result === "object" ? result.statusCode : undefined, 403);
});

test("validates idempotent workflow command and hospital decline reason", () => {
  const valid = validateCaseCommand({
    commandId: "command-001",
    type: "HOSPITAL_RESPONSE_RECORDED",
    expectedVersion: 5,
    payload: { requestId: "request-001", decision: "DECLINED", reasonCode: "NO_RESOURCE" },
  });
  assert.equal(valid.ok, true);

  const invalid = validateCaseCommand({
    commandId: "command-002",
    type: "HOSPITAL_RESPONSE_RECORDED",
    payload: { requestId: "request-001", decision: "DECLINED" },
  });
  assert.equal(invalid.ok, false);
});

test("validates the hospital route snapshot carried with a request", () => {
  assert.equal(validateCaseCommand({
    commandId: "command-route-001",
    type: "HOSPITAL_REQUEST_CREATED",
    payload: {
      requestId: "request-route-001",
      hospitalId: "hospital-route-001",
      hospitalName: "강원권역응급의료센터",
      distanceKm: 18.4,
      etaMinutes: 27,
    },
  }).ok, true);

  assert.equal(validateCaseCommand({
    commandId: "command-route-002",
    type: "HOSPITAL_REQUEST_CREATED",
    payload: {
      requestId: "request-route-002",
      hospitalId: "hospital-route-001",
      distanceKm: -1,
      etaMinutes: 2_000,
    },
  }).ok, false);

  assert.equal(validateCaseCommand({
    commandId: "command-route-003",
    type: "HOSPITAL_REQUEST_CREATED",
    payload: {
      requestId: "request-route-003",
      hospitalId: "hospital-route-001",
      etaMinutes: null,
    },
  }).ok, true);
});

test("accepts only the 16 kHz ko-KR PCM streaming contract", () => {
  assert.equal(validateTranscribeSession({ caseId: "GW-CARDIO-050", languageCode: "ko-KR", sampleRateHertz: 16000 }).ok, true);
  assert.equal(validateTranscribeSession({ caseId: "GW-CARDIO-050", sampleRateHertz: 48000 }).ok, false);
});

test("validates human-confirmed structured vital signs before persistence", () => {
  const valid = validateDirectFactsRequest({
    expectedVersion: 2,
    kind: "initial",
    facts: [
      { path: "vitals.systolicBp", value: 178, observedAt: "2026-08-03T14:10:00+09:00", sourceText: "구급대원 직접 입력" },
      { path: "consciousness.avpu", value: "A", sourceText: "구급대원 직접 확인" },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 2,
    kind: "initial",
    facts: [{ path: "vitals.spo2", value: 140, sourceText: "잘못된 값" }],
  }).ok, false);
});

test("validates the mobile ABC and chest-pain field contract", () => {
  const valid = validateDirectFactsRequest({
    expectedVersion: 0,
    kind: "initial",
    facts: [
      { path: "assessment.airway", value: "개방", sourceText: "기도 개방" },
      { path: "assessment.breathing", value: "자발호흡", sourceText: "자발호흡" },
      { path: "assessment.circulation", value: "맥박 촉지", sourceText: "맥박 촉지" },
      { path: "symptoms.chestPainNrs", value: 5, sourceText: "NRS 5" },
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 0,
    kind: "initial",
    facts: [{ path: "assessment.airway", value: "추정 개방", sourceText: "추정" }],
  }).ok, false);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 0,
    kind: "initial",
    facts: [{ path: "symptoms.chestPainNrs", value: 11, sourceText: "NRS 11" }],
  }).ok, false);
});

test("does not complete a step or unlock hospital inquiry from one accepted fact", () => {
  const partial = {
    caseId: "GW-CARDIO-050",
    version: 1,
    facts: {
      "assessment.airway": {
        value: "개방",
        sourceText: "기도 개방",
        confirmedAt: "2026-08-04T01:00:00Z",
        confirmedBy: "paramedic-01",
        proposalId: "proposal-001",
      },
    },
  };
  assert.deepEqual(completedInitialAssessmentSteps(partial), []);
  assert.ok(missingInitialAssessmentPaths(partial).length > 0);

  const completeFacts = Object.fromEntries(Object.values(INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP)
    .flat()
    .map((path) => [path, {
      value: path === "symptoms.associated" ? ["식은땀"] : path === "symptoms.chestPainNrs" ? 5 : "확인값",
      sourceText: "구급대원 확인",
      confirmedAt: "2026-08-04T01:00:00Z",
      confirmedBy: "paramedic-01",
      proposalId: "proposal-001",
    }]));
  const complete = { caseId: "GW-CARDIO-050", version: 17, facts: completeFacts };
  assert.deepEqual(completedInitialAssessmentSteps(complete), [1, 2, 3]);
  assert.deepEqual(missingInitialAssessmentPaths(complete), []);
});

test("keeps initial and reassessment direct-input paths separate", () => {
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 3,
    kind: "reassessment",
    facts: [{ path: "reassessment.spo2", value: 96, sourceText: "이송 중 직접 입력" }],
  }).ok, true);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 3,
    kind: "reassessment",
    facts: [{ path: "vitals.spo2", value: 96, sourceText: "이송 중 직접 입력" }],
  }).ok, false);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 3,
    kind: "initial",
    facts: [{ path: "reassessment.spo2", value: 96, sourceText: "최초 평가 직접 입력" }],
  }).ok, false);
});

test("adapts AgentCore proposal-only response into existing HITL schema", () => {
  const transcript = "혈압 178/96";
  const state: ConfirmedState = { caseId: "GW-CARDIO-050", version: 4, facts: {} };
  const output = normalizeAgentCoreResponse({
    proposal: {
      schemaVersion: "1.0",
      proposalId: "prop-0123456789abcdef01234567",
      caseId: "GW-CARDIO-050",
      baseVersion: 4,
      status: "PENDING_REVIEW",
      requiresHumanReview: true,
      authoritative: false,
      summary: "혈압 확인 후보를 정리했습니다.",
      changes: [{
        changeId: "chg-0123456789abcdef0123",
        path: "vitals.systolicBp",
        value: 178,
        unit: "mmHg",
        certainty: "clear",
        evidenceIds: ["ev-0123456789abcdef"],
      }],
    },
    evidence: [{
      evidenceId: "ev-0123456789abcdef",
      changeId: "chg-0123456789abcdef0123",
      field: "vitals.systolicBp",
      sourceText: transcript,
      start: 0,
      end: transcript.length,
    }],
    unknowns: [],
    warnings: [],
  }, { caseId: "GW-CARDIO-050", transcript, source: "ptt", requestedBy: "paramedic-01" }, state);
  assert.equal(output.changes[0]?.value, 178);
  assert.equal(output.changes[0]?.sourceText, transcript);
});

test("rejects an authoritative AgentCore response", () => {
  assert.throws(() => normalizeAgentCoreResponse({
    proposal: { status: "CONFIRMED", requiresHumanReview: false, authoritative: true, changes: [] },
    evidence: [], unknowns: [], warnings: [],
  }, { caseId: "GW-CARDIO-050", transcript: "상태 확인", source: "ptt", requestedBy: "paramedic-01" }, { caseId: "GW-CARDIO-050", version: 0, facts: {} }), AgentOutputError);
});

test("uses an opaque AgentCore runtime session id without the case id", () => {
  const sessionId = createAgentRuntimeSessionId();
  assert.match(sessionId, /^ems-relay-[0-9a-f-]{36}$/);
  assert.doesNotMatch(sessionId, /GW-CARDIO|CASE/i);
});

function finalizedReport(): AmbulanceActivityReport {
  return {
    reportId: "report-001",
    caseId: "GW-CARDIO-050",
    version: 3,
    status: "FINALIZED",
    reviewedFields: [...REQUIRED_REPORT_REVIEW_FIELDS],
    createdAt: "2026-08-03T14:00:00Z",
    createdBy: "paramedic-01",
    updatedAt: "2026-08-03T15:00:00Z",
    finalizedAt: "2026-08-03T15:00:00Z",
    finalizedBy: "paramedic-01",
    draft: {
      schema: "KR_AMBULANCE_ACTIVITY_ANNEX5_MVP_V1",
      generatedAt: "2026-08-03T14:50:00Z",
      administrative: { organization: "강원소방", vehicleNumber: "GW-01", approvals: {} },
      dispatchTimeline: { caseId: "GW-CARDIO-050", patientContactAt: "2026-08-03T14:10:00Z", handoffAcceptedAt: "2026-08-03T14:55:00Z" },
      patientIdentity: { age: 74, sex: "남성" },
      symptomsAndOccurrence: { chiefComplaint: "흉통" },
      patientAssessment: { consciousness: { avpu: "A" }, pupils: {}, vitalSigns: [{ systolicBp: 178, diastolicBp: 96, spo2: 97 }], severityLevel: {} },
      paramedicAssessment: { fieldImpression: "급성 관상동맥증후군 의심" },
      emergencyCare: { procedures: ["심전도 감시"] },
      medicalDirection: {},
      transport: { primaryDestinationHospitalId: "hospital-01" },
      handoff: { acceptedAt: "2026-08-03T14:55:00Z" },
      mutualAidAndNonTransport: { nonTransport: false },
      crewAndBarriers: { assignedParamedicIds: ["paramedic-01"], barriers: [] },
      missingFields: [],
    },
  };
}

test("maps only a finalized report to an idempotent FHIR transaction bundle", () => {
  const bundle = mapFinalizedReportToFhir(finalizedReport());
  assert.equal(bundle.type, "transaction");
  assert.ok(bundle.entry.some((entry) => entry.resource.resourceType === "Observation"));
  assert.ok(bundle.entry.every((entry) => entry.request.method === "PUT"));
  assert.equal(bundle.entry.some((entry) => entry.resource.resourceType === "Condition"), false);
});

test("renders Annex 5 sections in operational order", () => {
  const html = renderAnnex5Html(finalizedReport());
  const headings = ["기관·차량·결재", "신고·출동 시각", "환자 인적사항", "환자평가", "응급처치", "의료지도", "1·2차 이송", "인수자·인계"];
  let cursor = -1;
  for (const heading of headings) {
    const next = html.indexOf(heading);
    assert.ok(next > cursor, `${heading} section order`);
    cursor = next;
  }
});
