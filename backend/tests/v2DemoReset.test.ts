import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_CASE_IDS,
  DEMO_RESET_CONFIRMATION,
  assertDemoResetConfirmation,
  buildDemoCaseItems,
  demoCasePartitionKey,
  resetDemoCases,
  type DemoResetItem,
  type DemoResetKey,
  type DemoResetStorage,
} from "../src/v2/demoReset.js";
import { isMatchingStageEligible } from "../src/v2/matchingHandler.js";

test("demo reset requires the exact confirmation phrase", () => {
  assert.doesNotThrow(() => assertDemoResetConfirmation(DEMO_RESET_CONFIRMATION));
  for (const value of [undefined, true, "RESET", "reset_ems_relay_demo", `${DEMO_RESET_CONFIRMATION} `]) {
    assert.throws(() => assertDemoResetConfirmation(value));
  }
});

test("demo reset records restore exactly the three allow-listed cases", () => {
  const items = buildDemoCaseItems("paramedic-sub", Date.parse("2026-08-05T03:00:00.000Z"));
  assert.equal(items.length, 12);
  assert.deepEqual([...new Set(items.map(({ PK }) => PK))], DEMO_CASE_IDS.map(demoCasePartitionKey));
  for (const caseId of DEMO_CASE_IDS) {
    const partition = items.filter(({ PK }) => PK === demoCasePartitionKey(caseId));
    assert.equal(partition.length, 4);
    assert.deepEqual(partition.map(({ SK }) => SK.split("#")[0]).sort(), ["ASSIGNMENT", "EVENT", "META", "STATE"]);
    const meta = partition.find(({ SK }) => SK === "META");
    assert.equal(meta?.stage, "ASSIGNED");
    assert.deepEqual(meta?.assignedParamedicIds, ["paramedic-sub"]);
    assert.match(String(meta?.reportDetail), /^EMS Relay-00[1-3] · /);
    assert.doesNotMatch(String(meta?.reportDetail), /119 신고 내용으로 생성된/);
  }
  assert.throws(() => demoCasePartitionKey("REAL-CASE-001"));
});

test("demo reset queries and deletes only the three exact demo partitions", async () => {
  const listedPartitions: string[] = [];
  const deleted: DemoResetKey[] = [];
  let restored: DemoResetItem[] = [];
  const storage: DemoResetStorage = {
    async listPartitionKeys(PK) {
      listedPartitions.push(PK);
      return [
        { PK, SK: "META" },
        { PK, SK: "HOSPITAL_REQUEST#old" },
        { PK, SK: "MATCH_JOB#old#W1" },
        { PK, SK: "EVENT#old" },
      ];
    },
    async deleteKeys(keys) { deleted.push(...keys); },
    async putItems(items) { restored = items; },
  };

  const result = await resetDemoCases(storage, "paramedic-sub", Date.parse("2026-08-05T03:00:00.000Z"));
  const allowedPartitions = DEMO_CASE_IDS.map(demoCasePartitionKey);
  assert.deepEqual(listedPartitions, allowedPartitions);
  assert.equal(deleted.length, 12);
  assert.ok(deleted.every(({ PK }) => allowedPartitions.includes(PK)));
  assert.equal(restored.length, 12);
  assert.ok(restored.every(({ PK }) => allowedPartitions.includes(PK)));
  assert.deepEqual(result.caseIds, [...DEMO_CASE_IDS]);
  assert.equal(result.deletedItems, 12);
  assert.equal(result.restoredItems, 12);
});

test("demo reset aborts if a storage adapter returns a non-demo partition", async () => {
  let deleteCalled = false;
  const storage: DemoResetStorage = {
    async listPartitionKeys(PK) {
      return PK.endsWith("001") ? [{ PK: "CASE#REAL-CASE-001", SK: "META" }] : [];
    },
    async deleteKeys() { deleteCalled = true; },
    async putItems() { throw new Error("must not restore after scope validation fails"); },
  };
  await assert.rejects(() => resetDemoCases(storage, "paramedic-sub"));
  assert.equal(deleteCalled, false);
});

test("stale matching messages cannot run against a freshly reset assigned case", () => {
  assert.equal(isMatchingStageEligible("ASSESSING"), true);
  assert.equal(isMatchingStageEligible("HOSPITAL_REQUESTED"), true);
  for (const stage of ["ASSIGNED", "DISPATCHING", "ON_SCENE", "TRANSPORTING", "COMPLETE"]) {
    assert.equal(isMatchingStageEligible(stage), false);
  }
});
