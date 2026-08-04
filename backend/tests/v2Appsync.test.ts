import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  parseAwsJson,
  principalFromAppSyncIdentity,
  resolveHospitalScope,
} from "../src/v2/appsyncIdentity.js";
import { prepareManualStructuredFacts, resolveDirectFactsVersion } from "../src/v2/appsyncHandler.js";
import { validateVoiceProposalInput } from "../src/v2/voiceHandler.js";

test("derives AppSync roles and hospital scope only from Cognito claims", () => {
  const principal = principalFromAppSyncIdentity({
    sub: "ignored-top-level-sub",
    claims: {
      sub: "hospital-user-1",
      "cognito:groups": ["hospital"],
      "custom:hospital_id": "NMC-H001",
    },
  });
  assert.equal(principal.sub, "hospital-user-1");
  assert.deepEqual(principal.roles, ["hospital"]);
  assert.equal(resolveHospitalScope(principal), "NMC-H001");
  assert.throws(() => resolveHospitalScope(principal, "NMC-H999"));
  assert.throws(() => principalFromAppSyncIdentity({
    claims: { sub: "legacy-admin", "cognito:groups": ["admin"] },
  }));
});

test("accepts AppSync AWSJSON as either parsed object or serialized object", () => {
  assert.deepEqual(parseAwsJson({ decision: "ACCEPTED" }), { decision: "ACCEPTED" });
  assert.deepEqual(parseAwsJson('{"decision":"DECLINED"}'), { decision: "DECLINED" });
  assert.throws(() => parseAwsJson("[]"));
});

test("manual structured facts use the current confirmed-state version when omitted", () => {
  assert.equal(resolveDirectFactsVersion(undefined, 7), 7);
  assert.equal(resolveDirectFactsVersion(4, 7), 4);

  const directFacts = prepareManualStructuredFacts({
    kind: "initial",
    facts: [
      { path: "vitals.systolicBp", value: 178, sourceText: "수동 입력: 수축기 혈압 178" },
      { path: "vitals.diastolicBp", value: 96, sourceText: "수동 입력: 이완기 혈압 96" },
      { path: "vitals.pulse", value: 92, sourceText: "수동 입력: 맥박 92" },
    ],
  }, undefined, 7);

  assert.equal(directFacts.expectedVersion, 7);
  assert.equal(directFacts.kind, "initial");
  assert.deepEqual(directFacts.facts.map(({ path, value }) => [path, value]), [
    ["vitals.systolicBp", 178],
    ["vitals.diastolicBp", 96],
    ["vitals.pulse", 92],
  ]);

  const appSyncSource = readFileSync(join(process.cwd(), "src", "v2", "appsyncHandler.ts"), "utf8");
  assert.doesNotMatch(appSyncSource, /createV2VoiceProposal|client-bedrock-runtime|InvokeModel/);

  assert.throws(() => prepareManualStructuredFacts({
    kind: "initial",
    facts: [{ path: "vitals.spo2", value: 120, sourceText: "수동 입력: 산소포화도 120" }],
  }, undefined, 7));
});

test("voice proposals accept a bounded Korean transcript and remain scoped to a review focus", () => {
  assert.deepEqual(validateVoiceProposalInput({
    caseId: "GW-STROKE-001",
    transcript: "혈압 178에 96, 맥박 92입니다.",
    focus: "VITALS",
    observedAt: "2026-08-05T02:30:00+09:00",
  }), {
    caseId: "GW-STROKE-001",
    transcript: "혈압 178에 96, 맥박 92입니다.",
    focus: "VITALS",
    observedAt: "2026-08-05T02:30:00+09:00",
  });
  assert.throws(() => validateVoiceProposalInput({ caseId: "GW-STROKE-001", transcript: "  " }));
  assert.throws(() => validateVoiceProposalInput({ caseId: "GW-STROKE-001", transcript: "혈압 178", focus: "DIAGNOSIS" }));
});

test("v2 schema exposes only the two-user workflow contracts and subscriptions", () => {
  const schema = readFileSync(join(process.cwd(), "schemas", "v2.graphql"), "utf8");
  for (const field of [
    "listMyCases",
    "getCase",
    "listHospitalInbox",
    "executeCommand",
    "requestHospitalMatching",
    "createTranscribeSession",
    "structureVoiceUpdate",
    "onCaseUpdate",
    "onHospitalInbox",
  ]) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.match(schema, /onCaseUpdate[\s\S]*cognito_groups: \["paramedic"\]/);
  assert.match(schema, /onHospitalInbox[\s\S]*cognito_groups: \["hospital"\]/);
  assert.match(schema, /type CaseUpdate\s+@aws_cognito_user_pools\s+@aws_iam/);
  for (const field of [
    "reportTime",
    "reportSummary",
    "reportDetail",
    "estimatedAge",
    "estimatedSex",
    "reporter",
    "station",
    "sceneAddress",
    "sceneLatitude",
    "sceneLongitude",
  ]) assert.match(schema, new RegExp(`\\b${field}\\b`));
  assert.doesNotMatch(schema, /HealthLake|Kinesis|FHIR|Report|Control/);
});

test("events after destination selection remain visible to the selected hospital subscription", () => {
  const source = readFileSync(join(process.cwd(), "src", "v2", "appsyncHandler.ts"), "utf8");
  assert.match(source, /indexedRequest\?\.hospitalId[\s\S]*?: meta\.destinationHospitalId/);
  assert.match(source, /REASSESSMENT_CONFIRMED[\s\S]*?meta\.destinationHospitalId[\s\S]*?hospitalId/);
});

test("active backend contracts contain no legacy roles, reports, or FHIR events", () => {
  const types = readFileSync(join(process.cwd(), "src", "types.ts"), "utf8");
  const auth = readFileSync(join(process.cwd(), "src", "auth.ts"), "utf8");
  const workflow = readFileSync(join(process.cwd(), "src", "workflowStore.ts"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src", "v2", "repository.ts"), "utf8");
  assert.doesNotMatch(types, /"control"|"admin"|REPORT_DRAFTED|REPORT_REVIEWED|REPORT_FINALIZED|FHIR_PUBLISHED/);
  assert.doesNotMatch(auth, /APIGatewayProxyEventV2|principalFromEvent|"control"|"admin"/);
  assert.doesNotMatch(workflow, /REPORT_DRAFTED|REPORT_REVIEWED|REPORT_FINALIZED|FHIR_PUBLISHED|appendInternalEvent/);
  assert.match(repository, /actorSub: "MATCHING_WORKER",\s*actorRole: "system"/);
});

test("v2 infrastructure keeps only paramedic and hospital groups and exports deployment wiring", () => {
  const template = readFileSync(join(process.cwd(), "template-v2.yaml"), "utf8");
  assert.match(template, /GroupName: paramedic/);
  assert.match(template, /GroupName: hospital/);
  assert.match(template, /SQSPollerPolicy/);
  assert.match(template, /VoiceFunction:/);
  assert.match(template, /VOICE_AGENT_TIMEOUT_MS: "8000"/);
  assert.match(template, /transcribe:StartStreamTranscriptionWebSocket/);
  assert.match(template, /bedrock:InvokeModel/);
  assert.doesNotMatch(template, /AgentCore|LangGraph/);
  assert.doesNotMatch(template, /AdminGroup|GroupName: admin/);
  for (const output of [
    "GraphQLUrl",
    "UserPoolId",
    "UserPoolClientId",
    "CognitoDomain",
    "CaseTableName",
    "MatchingQueueUrl",
  ]) assert.match(template, new RegExp(`^  ${output}:`, "m"));
});

test("v2 seed contains three stroke demo cases and the expanded dispatch metadata", () => {
  const seed = readFileSync(join(process.cwd(), "scripts", "seed-v2.mjs"), "utf8");
  for (const caseId of ["GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-003"]) {
    assert.match(seed, new RegExp(caseId));
  }
  for (const field of ["reportTime", "reportSummary", "reportDetail", "sceneLatitude", "sceneLongitude"]) {
    assert.match(seed, new RegExp(`\\b${field}\\b`));
  }
});
