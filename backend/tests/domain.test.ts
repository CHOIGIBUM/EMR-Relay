import assert from "node:assert/strict";
import test from "node:test";
import { applyProposalDecisions, buildConfirmationTransaction, StoreConflictError } from "../src/store.js";
import type { AgentProposal, CaseMeta, ConfirmedState } from "../src/types.js";

const current: ConfirmedState = {
  caseId: "GW-CARDIO-050",
  version: 3,
  facts: {},
  createdAt: "2026-08-03T14:20:00+09:00",
  updatedAt: "2026-08-03T14:27:00+09:00",
};

const proposal: AgentProposal = {
  proposalId: "proposal-001",
  caseId: "GW-CARDIO-050",
  status: "PENDING",
  baseVersion: 3,
  schemaVersion: "1.0",
  summary: "활력징후 변경안",
  changes: [
    {
      changeId: "change-001",
      path: "vitals.systolicBp",
      value: 163,
      unit: "mmHg",
      certainty: "clear",
      sourceText: "혈압 163에 90",
    },
    {
      changeId: "change-002",
      path: "vitals.diastolicBp",
      value: 90,
      unit: "mmHg",
      certainty: "clear",
      sourceText: "혈압 163에 90",
    },
  ],
  flags: [],
  transcriptHash: "hash",
  source: "ptt",
  requestedBy: "PARAMEDIC-01",
  createdAt: "2026-08-03T14:28:00+09:00",
};

test("applies only human-accepted proposal fields and preserves provenance", () => {
  const result = applyProposalDecisions(
    current,
    proposal,
    [
      { changeId: "change-001", action: "accept", value: 165 },
      { changeId: "change-002", action: "reject" },
    ],
    "PARAMEDIC-02",
    "2026-08-03T14:29:00+09:00",
  );

  assert.equal(result.nextState.version, 4);
  assert.equal(result.nextState.facts["vitals.systolicBp"]?.value, 165);
  assert.equal(result.nextState.facts["vitals.systolicBp"]?.confirmedBy, "PARAMEDIC-02");
  assert.equal(result.nextState.facts["vitals.diastolicBp"], undefined);
  assert.deepEqual(result.acceptedPaths, ["vitals.systolicBp"]);
  assert.deepEqual(result.rejectedPaths, ["vitals.diastolicBp"]);
});

test("refuses partial HITL decisions", () => {
  assert.throws(
    () => applyProposalDecisions(
      current,
      proposal,
      [{ changeId: "change-001", action: "accept" }],
      "PARAMEDIC-02",
      "2026-08-03T14:29:00+09:00",
    ),
    StoreConflictError,
  );
});

const workflowMeta: CaseMeta = {
  caseId: "GW-CARDIO-050",
  version: 8,
  stage: "ASSESSING",
  assignedParamedicIds: ["PARAMEDIC-02"],
  createdAt: "2026-08-03T14:00:00+09:00",
  updatedAt: "2026-08-03T14:28:00+09:00",
};

test("builds confirmed state and workflow event in one DynamoDB transaction", () => {
  const prepared = buildConfirmationTransaction({
    caseId: current.caseId,
    current,
    proposal,
    request: {
      proposalId: proposal.proposalId,
      expectedVersion: current.version,
      reviewedBy: "PARAMEDIC-02",
      decisions: proposal.changes.map((change) => ({ changeId: change.changeId, action: "accept" as const })),
    },
    meta: workflowMeta,
    actorRole: "paramedic",
    confirmedAt: "2026-08-03T14:29:00+09:00",
    confirmationAuditId: "audit-confirmed-001",
    eventId: "event-confirmed-001",
  });

  assert.equal(prepared.transactItems.length, 5);
  assert.ok(prepared.transactItems.some((item) => item.Update?.Key?.SK === "STATE#CONFIRMED"));
  assert.ok(prepared.transactItems.some((item) => item.Put?.Item?.SK === "META"));
  const eventItem = prepared.transactItems.find((item) => item.Put?.Item?.entityType === "CASE_EVENT")?.Put?.Item;
  assert.equal(eventItem?.type, "PATIENT_FACTS_CONFIRMED");
  assert.equal(eventItem?.actorSub, "PARAMEDIC-02");
  assert.equal(eventItem?.actorRole, "paramedic");
  assert.equal(eventItem?.version, 9);
  assert.deepEqual(eventItem?.payload, {
    proposalId: "proposal-001",
    acceptedPaths: ["vitals.systolicBp", "vitals.diastolicBp"],
    rejectedPaths: [],
    actor: "PARAMEDIC-02",
    inputMethod: "ptt",
    status: "CONFIRMED",
    version: 4,
  });
});

test("infers a voice reassessment event from human-accepted reassessment paths", () => {
  const reassessmentProposal: AgentProposal = {
    ...proposal,
    proposalId: "proposal-reassessment-001",
    source: "ptt",
    changes: [{
      changeId: "change-reassessment-001",
      path: "reassessment.spo2",
      value: 95,
      unit: "%",
      certainty: "clear",
      sourceText: "재평가 산소포화도 95",
    }],
  };
  const prepared = buildConfirmationTransaction({
    caseId: current.caseId,
    current,
    proposal: reassessmentProposal,
    request: {
      proposalId: reassessmentProposal.proposalId,
      expectedVersion: current.version,
      reviewedBy: "PARAMEDIC-02",
      decisions: [{ changeId: "change-reassessment-001", action: "accept" }],
    },
    meta: { ...workflowMeta, stage: "TRANSPORTING" },
    actorRole: "paramedic",
    confirmedAt: "2026-08-03T14:40:00+09:00",
    confirmationAuditId: "audit-confirmed-002",
    eventId: "event-confirmed-002",
  });
  const eventItem = prepared.transactItems.find((item) => item.Put?.Item?.entityType === "CASE_EVENT")?.Put?.Item;
  assert.equal(eventItem?.type, "REASSESSMENT_CONFIRMED");
  assert.equal(eventItem?.payload?.inputMethod, "ptt");
});

test("puts a direct confirmation proposal and its reassessment event atomically", () => {
  const directProposal: AgentProposal = {
    ...proposal,
    proposalId: "proposal-direct-001",
    source: "manual",
    changes: [{
      changeId: "change-direct-001",
      path: "reassessment.pulse",
      value: 88,
      unit: "/min",
      certainty: "clear",
      sourceText: "구급대원 직접 입력",
    }],
  };
  const prepared = buildConfirmationTransaction({
    caseId: current.caseId,
    current,
    proposal: directProposal,
    request: {
      proposalId: directProposal.proposalId,
      expectedVersion: current.version,
      reviewedBy: "PARAMEDIC-02",
      decisions: [{ changeId: "change-direct-001", action: "accept" }],
    },
    meta: { ...workflowMeta, stage: "TRANSPORTING" },
    actorRole: "paramedic",
    kind: "reassessment",
    proposalIsNew: true,
    confirmedAt: "2026-08-03T14:45:00+09:00",
    confirmationAuditId: "audit-confirmed-003",
    proposalCreatedAuditId: "audit-created-003",
    eventId: "event-confirmed-003",
  });

  assert.equal(prepared.transactItems.length, 6);
  const proposalItem = prepared.transactItems.find((item) => item.Put?.Item?.entityType === "PROPOSAL")?.Put?.Item;
  const eventItems = prepared.transactItems.filter((item) => item.Put?.Item?.entityType === "CASE_EVENT");
  assert.equal(proposalItem?.status, "CONFIRMED");
  assert.equal(eventItems.length, 1);
  assert.equal(eventItems[0]?.Put?.Item?.type, "REASSESSMENT_CONFIRMED");
  assert.equal(eventItems[0]?.Put?.Item?.payload?.inputMethod, "manual");
  assert.equal(eventItems[0]?.Put?.Item?.payload?.status, "CONFIRMED");
  assert.equal(eventItems[0]?.Put?.Item?.payload?.kind, "reassessment");
});
