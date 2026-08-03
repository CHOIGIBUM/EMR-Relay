import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

test("Cognito callback validates one-time state and nonce before storing the session", () => {
  const auth = read("lib/cognitoAuth.ts");
  const callback = read("components/auth/CallbackScreen.tsx");

  assert.match(auth, /sessionStorage\.setItem\(STATE_KEY, state\)/);
  assert.match(auth, /sessionStorage\.setItem\(NONCE_KEY, nonce\)/);
  assert.match(auth, /new URLSearchParams\(\{[\s\S]*?state,[\s\S]*?nonce,/);
  assert.match(auth, /constantTimeEqual\(expectedState, returnedState\)/);
  assert.match(auth, /constantTimeEqual\(idClaims\.nonce, expectedNonce\)/);
  assert.match(auth, /sessionStorage\.removeItem\(STATE_KEY\)/);
  assert.match(auth, /sessionStorage\.removeItem\(NONCE_KEY\)/);
  assert.match(callback, /\.get\("state"\)/);
  assert.match(callback, /completeCognitoSignIn\(code, state\)/);
});

test("post-login return target is restricted to a same-origin absolute path", () => {
  const auth = read("lib/cognitoAuth.ts");

  assert.match(auth, /!value\.startsWith\("\/"\)/);
  assert.match(auth, /value\.startsWith\("\/\/"\)/);
  assert.match(auth, /value\.includes\("\\\\"\)/);
  assert.match(auth, /\\u0000-\\u001f\\u007f/);
  assert.match(auth, /sessionStorage\.setItem\(RETURN_KEY, safeReturnTo\(returnTo\)\)/);
  assert.match(auth, /const returnTo = safeReturnTo\(sessionStorage\.getItem\(RETURN_KEY\)\)/);
});

test("audio worklet emits 90 ms PCM batches and flushes the final remainder in order", () => {
  const workletSource = read("public/audio-processor.worklet.js");
  let Processor;
  class AudioWorkletProcessorStub {
    constructor() {
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
      };
    }
  }
  const context = vm.createContext({
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    Float32Array,
    Int16Array,
    Math,
    sampleRate: 48_000,
    registerProcessor: (_name, implementation) => { Processor = implementation; },
  });
  vm.runInContext(workletSource, context);

  const processor = new Processor({ processorOptions: { outputSampleRate: 16_000 } });
  assert.equal(processor.batchSamples, 1_440);
  processor.emit(new Int16Array(1_439));
  assert.equal(processor.port.messages.length, 0, "90 ms가 되기 전에는 프레임을 보내지 않아야 합니다.");
  processor.emit(new Int16Array(1));
  assert.equal(processor.port.messages.length, 1);
  assert.equal(processor.port.messages[0].byteLength, 2_880);

  processor.emit(new Int16Array(320));
  processor.port.onmessage({ data: { type: "flush" } });
  assert.equal(processor.port.messages[1].byteLength, 640);
  assert.equal(processor.port.messages[2]?.type, "flushed");
});

test("PTT release flushes captured audio, terminates the stream, then waits for confirmed text", () => {
  const hook = read("hooks/useTranscribePtt.ts");
  const stopStart = hook.indexOf("const stop = useCallback");
  const stopEnd = hook.indexOf("const cancel = useCallback", stopStart);
  const stop = hook.slice(stopStart, stopEnd);

  const flush = stop.indexOf("await flushWorklet(active.worklet)");
  const terminate = stop.indexOf("encodeAudioEvent(new ArrayBuffer(0))");
  const wait = stop.indexOf("await finalTranscriptReady");
  const close = stop.indexOf("active.socket.close", wait);
  const confirmedReturn = stop.lastIndexOf('finalPartsRef.current.join(" ")');

  assert.ok(flush >= 0 && terminate > flush, "마지막 음성 묶음을 먼저 보낸 뒤 스트림을 종료해야 합니다.");
  assert.ok(wait > terminate, "스트림 종료 뒤 최종 인식 문장을 기다려야 합니다.");
  assert.ok(close > wait, "최종 문장을 기다리는 동안 소켓을 열어 두어야 합니다.");
  assert.ok(confirmedReturn > close, "반환값은 확정된 인식 문장으로 구성해야 합니다.");
  assert.doesNotMatch(stop.slice(confirmedReturn), /partialRef/, "부분 인식 문장을 최종 입력으로 확정하면 안 됩니다.");
  assert.match(hook, /await disposeResources\(pending, true\)/, "초기화 실패 시 마이크·소켓·오디오 컨텍스트를 정리해야 합니다.");
  assert.match(hook, /worklet\.port\.postMessage\(\{ type: "flush" \}\)/);
  assert.match(hook, /event\.data\?\.type === "flushed"/);
});
