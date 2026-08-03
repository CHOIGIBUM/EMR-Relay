import assert from "node:assert/strict";
import test from "node:test";
import { applyProposalDecisions, StoreConflictError } from "../src/store.js";
import type { AgentProposal, ConfirmedState } from "../src/types.js";

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
