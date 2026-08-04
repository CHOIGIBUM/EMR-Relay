import assert from "node:assert/strict";
import test from "node:test";
import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import type { ConfirmedState } from "../src/types.js";
import {
  createV2VoiceProposal,
  tryCreateDeterministicVitalsOutput,
  VoiceAgentTimeoutError,
  type VoiceModelInvoker,
} from "../src/v2/voiceAgent.js";

const state: ConfirmedState = {
  caseId: "GW-STROKE-001",
  version: 3,
  facts: {},
};

function responseWithToolInput(input: Record<string, unknown>): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: {
        role: "assistant",
        content: [{
          toolUse: {
            toolUseId: "tool-use-001",
            name: "submit_patient_update",
            input,
          },
        }],
      },
    },
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    metrics: { latencyMs: 240 },
  } as ConverseCommandOutput;
}

test("turns a colloquial Korean vital-sign update into pending review facts", async () => {
  const transcript = "혈압은 178에 96이고요, 맥박은 92, 호흡은 18, 산소포화도 97, 혈당 118이에요.";
  let invoked = false;
  const invokeModel: VoiceModelInvoker = async () => {
    invoked = true;
    throw new Error("deterministic vital input must not call Bedrock");
  };

  const result = await createV2VoiceProposal({
    caseId: state.caseId,
    transcript,
    requestedBy: "paramedic-001",
    focus: "VITALS",
    observedAt: "2026-08-05T04:16:00+09:00",
  }, state, { invokeModel, timeoutMs: 100 });

  assert.equal(result.proposal.status, "PENDING");
  assert.equal(result.proposal.baseVersion, 3);
  assert.equal(result.proposal.source, "ptt");
  assert.deepEqual(
    result.proposal.changes.map(({ path, value }) => [path, value]),
    [
      ["vitals.systolicBp", 178],
      ["vitals.diastolicBp", 96],
      ["vitals.pulse", 92],
      ["vitals.respiratoryRate", 18],
      ["vitals.spo2", 97],
      ["vitals.glucose", 118],
    ],
  );
  assert.equal(result.usage.latencyMs, 0);
  assert.equal(invoked, false);
});

test("rejects an out-of-range deterministic vital instead of proposing it", () => {
  assert.throws(
    () => tryCreateDeterministicVitalsOutput("산소포화도 130퍼센트입니다."),
    /활력징후 범위/,
  );
});

test("aborts and returns a specific error when Bedrock exceeds the voice budget", async () => {
  let observedSignal: AbortSignal | undefined;
  const neverReturns: VoiceModelInvoker = async (_command, abortSignal) => {
    observedSignal = abortSignal;
    return new Promise<ConverseCommandOutput>(() => undefined);
  };

  await assert.rejects(
    createV2VoiceProposal({
      caseId: state.caseId,
      transcript: "현재 상태를 메모합니다.",
      requestedBy: "paramedic-001",
      focus: "BASIC",
    }, state, { invokeModel: neverReturns, timeoutMs: 5 }),
    (error: unknown) => error instanceof VoiceAgentTimeoutError && error.timeoutMs === 5,
  );
  assert.equal(observedSignal?.aborted, true);
});

test("surfaces a Bedrock transport error without persisting a proposal", async () => {
  const invokeModel: VoiceModelInvoker = async () => {
    throw new Error("BEDROCK_UNAVAILABLE");
  };

  await assert.rejects(
    createV2VoiceProposal({
      caseId: state.caseId,
      transcript: "현재 상태를 메모합니다.",
      requestedBy: "paramedic-001",
      focus: "BASIC",
    }, state, { invokeModel, timeoutMs: 100 }),
    /BEDROCK_UNAVAILABLE/,
  );
});
