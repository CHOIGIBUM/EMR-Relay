import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_ASSESSMENT_PATHS_BY_STEP,
  SCENARIO,
  completedAssessmentSequences,
  hospitalOptionsFromSnapshot,
  hospitalRequestSnapshot,
  snapshotToScenario,
  snapshotToState,
} from "../components/DemoContext.tsx";
import { createLocalVoiceProposal, LocalDemoApiError } from "../lib/localDemoApi.ts";

const confirmed = (value) => ({
  value,
  sourceText: "구급대원 확인",
  confirmedAt: "2026-08-04T01:00:00Z",
  confirmedBy: "paramedic-01",
  proposalId: "proposal-001",
});

test("requires every field in a mobile assessment step before completing it", () => {
  const partial = new Set(REQUIRED_ASSESSMENT_PATHS_BY_STEP[1].slice(0, -1));
  assert.deepEqual(completedAssessmentSequences(partial), []);
  partial.add(REQUIRED_ASSESSMENT_PATHS_BY_STEP[1].at(-1));
  assert.deepEqual(completedAssessmentSequences(partial), [1]);
});

test("rebuilds completion from the canonical confirmed facts after refresh", () => {
  const facts = Object.fromEntries(REQUIRED_ASSESSMENT_PATHS_BY_STEP[1].map((path) => [
    path,
    confirmed(path === "consciousness.avpu" ? "A" : "확인값"),
  ]));
  const snapshot = {
    caseId: "GW-CARDIO-051",
    confirmedState: { caseId: "GW-CARDIO-051", version: 5, facts },
    proposals: [],
    audit: [],
    meta: { caseId: "GW-CARDIO-051", version: 7, stage: "ASSESSING", assignedParamedicIds: [] },
    events: [],
    hospitalRequests: [],
  };
  const state = snapshotToState(snapshot);
  assert.deepEqual(state.confirmedPttIds, ["GW-CARDIO-051-U01"]);
  assert.equal(state.stage, "assessing");
});

test("maps assignment estimates and dispatch summary instead of meta scenario", () => {
  const snapshot = {
    caseId: "GW-CARDIO-051",
    confirmedState: { caseId: "GW-CARDIO-051", version: 0, facts: {} },
    proposals: [],
    audit: [],
    meta: {
      caseId: "GW-CARDIO-051",
      version: 1,
      stage: "ASSIGNED",
      scenario: "내부 시나리오 전체 설명문",
      assignedParamedicIds: [],
    },
    events: [{
      eventId: "event-001",
      type: "CASE_ASSIGNED",
      actorSub: "control-01",
      actorRole: "control",
      occurredAt: "2026-08-04T00:00:00Z",
      version: 1,
      summary: "배정",
      payload: {
        estimatedAgeBand: "65-74",
        estimatedSex: "여성 추정",
        dispatchSummary: "흉통과 호흡곤란",
      },
    }],
    hospitalRequests: [],
  };
  const scenario = snapshotToScenario(snapshot, SCENARIO);
  assert.equal(scenario.reportedPatient, "65-74세 추정 · 여성 추정");
  assert.equal(scenario.reportedComplaint, "흉통과 호흡곤란");
  assert.notEqual(scenario.reportedComplaint, snapshot.meta.scenario);
});

test("restores the requested hospital name and route snapshot in separate workspaces", () => {
  const snapshot = {
    caseId: "GW-CARDIO-052",
    confirmedState: { caseId: "GW-CARDIO-052", version: 0, facts: {} },
    proposals: [],
    audit: [],
    hospitalRequests: [{
      requestId: "request-052",
      hospitalId: "hospital-052",
      hospitalName: "강원권역응급의료센터",
      distanceKm: 18.4,
      etaMinutes: 27,
      status: "REQUESTED",
      requestedBy: "paramedic-01",
      createdAt: "2026-08-04T01:00:00Z",
      updatedAt: "2026-08-04T01:00:00Z",
    }],
  };

  const [hospital] = hospitalOptionsFromSnapshot(snapshot);
  assert.equal(hospital.name, "강원권역응급의료센터");
  assert.equal(hospital.distance, "18.4 km");
  assert.equal(hospital.eta, "27분");
  assert.deepEqual(hospitalRequestSnapshot(hospital), {
    hospitalName: "강원권역응급의료센터",
    distanceKm: 18.4,
    etaMinutes: 27,
  });
});

test("uses explicit unavailable labels when an older request has no route snapshot", () => {
  const [hospital] = hospitalOptionsFromSnapshot({
    caseId: "GW-CARDIO-052",
    confirmedState: { caseId: "GW-CARDIO-052", version: 0, facts: {} },
    proposals: [],
    audit: [],
    hospitalRequests: [{
      requestId: "request-legacy",
      hospitalId: "hospital-legacy",
      status: "REQUESTED",
      requestedBy: "paramedic-01",
      createdAt: "2026-08-04T01:00:00Z",
      updatedAt: "2026-08-04T01:00:00Z",
    }],
  });

  assert.equal(hospital.name, "병원명 미제공");
  assert.equal(hospital.distance, "거리 미제공");
  assert.equal(hospital.eta, "ETA 미제공");
});

test("accepts only MobileApp's fixed structured local templates", async () => {
  const initial = await createLocalVoiceProposal({
    case_id: "GW-CARDIO-050",
    update_id: "GW-CARDIO-050-U01",
    transcript: "환자 접촉 후 초기 평가입니다. 기도 개방, 호흡 자발호흡, 순환 맥박 촉지입니다. 의식수준은 AVPU A입니다. 주호소는 흉통입니다.",
  });
  assert.deepEqual(initial.proposed_updates.map((item) => item.field_path), REQUIRED_ASSESSMENT_PATHS_BY_STEP[1]);

  const focused = await createLocalVoiceProposal({
    case_id: "GW-CARDIO-050",
    update_id: "GW-CARDIO-050-U02",
    transcript: "증상 발생시각은 09:38입니다. 흉통은 NRS 5, 압박하는 양상이며 방사통은 왼팔입니다. 동반증상은 식은땀, 오심입니다. 과거력은 미확인, 복용약은 미확인, 알레르기는 미확인입니다.",
  });
  assert.deepEqual(focused.proposed_updates.map((item) => item.field_path), REQUIRED_ASSESSMENT_PATHS_BY_STEP[2]);

  const vitals = await createLocalVoiceProposal({
    case_id: "GW-CARDIO-050",
    update_id: "GW-CARDIO-050-U03",
    transcript: "최초 활력징후는 혈압 163/90 mmHg, 맥박 91회/분, 호흡수 23회/분, 산소포화도 96%, 체온 37.4도, 혈당 116 mg/dL입니다. 시행 처치는 없음입니다.",
  });
  assert.deepEqual(vitals.proposed_updates.slice(0, 7).map((item) => item.field_path), REQUIRED_ASSESSMENT_PATHS_BY_STEP[3]);

  await assert.rejects(
    createLocalVoiceProposal({ case_id: "GW-CARDIO-050", update_id: "GW-CARDIO-050-U01", transcript: "임의 문장" }),
    (error) => error instanceof LocalDemoApiError && error.status === 422,
  );
});
