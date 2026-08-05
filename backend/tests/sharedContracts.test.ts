import assert from "node:assert/strict";
import test from "node:test";
import { completedInitialAssessmentSteps, missingInitialAssessmentPaths } from "../src/assessmentContract.js";
import { authorizeCommand } from "../src/auth.js";
import { normalizeAgentModelCandidate, validateAgentModelOutput, validateDirectFactsRequest } from "../src/schemas.js";
import type { AuthPrincipal, ConfirmedState, FactPath, ProposalValue } from "../src/types.js";
import { INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP } from "../src/types.js";
import { validateCaseCommand, validateTranscribeSession } from "../src/workflowSchemas.js";

test("authorizes only the two active AppSync user roles", () => {
  const paramedic: AuthPrincipal = { sub: "paramedic-01", roles: ["paramedic"] };
  const hospital: AuthPrincipal = { sub: "hospital-01", hospitalId: "A2200012", roles: ["hospital"] };
  assert.doesNotThrow(() => authorizeCommand(paramedic, "PATIENT_CONTACT"));
  assert.throws(() => authorizeCommand(paramedic, "HOSPITAL_RESPONSE_RECORDED"));
  assert.doesNotThrow(() => authorizeCommand(hospital, "HOSPITAL_RESPONSE_RECORDED"));
  assert.throws(() => authorizeCommand(hospital, "CASE_ASSIGNED"));
});

test("validates the v2 hospital broadcast and response contracts", () => {
  const broadcast = validateCaseCommand({
    commandId: "broadcast-command-001",
    type: "HOSPITAL_BROADCAST_STARTED",
    expectedVersion: 7,
    payload: {
      broadcastId: "broadcast-001",
      wave: 1,
      radiusKm: 15,
      responseWindowSeconds: 120,
      hospitals: [
        {
          requestId: "request-001",
          hospitalId: "A2200012",
          hospitalName: "강원특별자치도속초의료원",
          distanceKm: 2.2,
          etaMinutes: 6,
        },
      ],
    },
  });
  assert.equal(broadcast.ok, true);

  const response = validateCaseCommand({
    commandId: "hospital-response-001",
    type: "HOSPITAL_RESPONSE_RECORDED",
    expectedVersion: 8,
    payload: { requestId: "request-001", decision: "ACCEPTED" },
  });
  assert.equal(response.ok, true);
});

test("rejects duplicate hospitals and an unsupported Transcribe format", () => {
  const duplicate = validateCaseCommand({
    commandId: "broadcast-command-002",
    type: "HOSPITAL_BROADCAST_STARTED",
    payload: {
      broadcastId: "broadcast-002",
      wave: 1,
      radiusKm: 15,
      responseWindowSeconds: 120,
      hospitals: [
        { requestId: "request-002", hospitalId: "A2200012", hospitalName: "병원 1", distanceKm: 2, etaMinutes: 5 },
        { requestId: "request-003", hospitalId: "A2200012", hospitalName: "병원 1", distanceKm: 2, etaMinutes: 5 },
      ],
    },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(validateTranscribeSession({ caseId: "EMS-Relay-001", languageCode: "ko-KR", sampleRateHertz: 16_000 }).ok, true);
  assert.equal(validateTranscribeSession({ caseId: "EMS-Relay-001", languageCode: "en-US", sampleRateHertz: 48_000 }).ok, false);
});

test("keeps structured manual input inside clinical ranges", () => {
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 2,
    kind: "initial",
    facts: [
      { path: "vitals.systolicBp", value: 178, observedAt: "2026-08-05T05:38:00+09:00", sourceText: "구급대원 직접 입력" },
      { path: "vitals.spo2", value: 97, observedAt: "2026-08-05T05:38:00+09:00", sourceText: "구급대원 직접 입력" },
    ],
  }).ok, true);
  assert.equal(validateDirectFactsRequest({
    expectedVersion: 2,
    kind: "initial",
    facts: [{ path: "vitals.spo2", value: 140, sourceText: "잘못된 값" }],
  }).ok, false);
});

test("only marks a complete three-step patient assessment as complete", () => {
  const partial: ConfirmedState = {
    caseId: "EMS-Relay-001",
    version: 1,
    facts: {
      "patient.age": {
        value: 78,
        sourceText: "구급대원 직접 확인",
        confirmedAt: "2026-08-05T05:38:00+09:00",
        confirmedBy: "paramedic-01",
        proposalId: "manual-001",
      },
    },
  };
  assert.deepEqual(completedInitialAssessmentSteps(partial), []);
  assert.ok(missingInitialAssessmentPaths(partial).length > 0);

  const valueFor = (path: FactPath): ProposalValue => {
    const values: Partial<Record<FactPath, ProposalValue>> = {
      "patient.age": 78,
      "patient.sex": "여성",
      "assessment.airway": "개방",
      "assessment.breathing": "자발호흡",
      "assessment.circulation": "맥박 촉지",
      "consciousness.avpu": "A",
      "assessment.cpss.face": "우측 이상",
      "assessment.cpss.arm": "우측 이상",
      "assessment.cpss.speech": "구음장애",
      "assessment.cpss.score": 3,
      "vitals.systolicBp": 178,
      "vitals.diastolicBp": 96,
      "vitals.pulse": 92,
      "vitals.respiratoryRate": 18,
      "vitals.spo2": 97,
      "vitals.glucose": 118,
    };
    return values[path] ?? "확인됨";
  };
  const facts = Object.fromEntries(Object.values(INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP)
    .flat()
    .map((path) => [path, {
      value: valueFor(path),
      sourceText: "구급대원 직접 확인",
      confirmedAt: "2026-08-05T05:38:00+09:00",
      confirmedBy: "paramedic-01",
      proposalId: "manual-001",
    }]));
  const complete: ConfirmedState = { caseId: "EMS-Relay-001", version: 17, facts };
  assert.deepEqual(completedInitialAssessmentSteps(complete), [1, 2, 3]);
  assert.deepEqual(missingInitialAssessmentPaths(complete), []);
});

test("rejects an out-of-scope AI proposal", () => {
  assert.equal(validateAgentModelOutput({
    schemaVersion: "1.0",
    summary: "현장 발화를 정리했습니다.",
    changes: [{
      path: "hospital.recommended",
      value: "임의 병원",
      certainty: "clear",
      sourceText: "이 병원으로 가세요",
    }],
    flags: [],
  }).ok, false);
});

test("normalizes equivalent model enum aliases before strict clinical validation", () => {
  const normalized = normalizeAgentModelCandidate({
    schemaVersion: "1.0",
    summary: "명시된 기본 상태를 정리했습니다.",
    changes: [
      { path: "patient.age", value: "74", certainty: "clear", sourceText: "74세" },
      { path: "patient.sex", value: "male", certainty: "clear", sourceText: "남성" },
      { path: "assessment.airway", value: "patent", certainty: "clear", sourceText: "기도 개방" },
      { path: "assessment.breathing", value: "spontaneous", certainty: "clear", sourceText: "자발호흡" },
      { path: "assessment.circulation", value: "palpable pulse", certainty: "clear", sourceText: "맥박 촉지" },
      { path: "consciousness.avpu", value: "v", certainty: "clear", sourceText: "의식은 V" },
      { path: "symptoms.chiefComplaint", value: ["말이 어눌함", "오른팔 약화"], certainty: "clear", sourceText: "말이 어눌하고 오른팔에 힘이 빠짐" },
    ],
    flags: [],
  });
  const validation = validateAgentModelOutput(normalized);
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.deepEqual(validation.value.changes.map(({ path, value }) => [path, value]), [
    ["patient.age", 74],
    ["patient.sex", "남성"],
    ["assessment.airway", "개방"],
    ["assessment.breathing", "자발호흡"],
    ["assessment.circulation", "맥박 촉지"],
    ["consciousness.avpu", "V"],
    ["symptoms.chiefComplaint", "말이 어눌함, 오른팔 약화"],
  ]);
});
