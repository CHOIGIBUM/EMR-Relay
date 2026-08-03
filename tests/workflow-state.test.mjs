import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtWorkerPath = path.join(projectRoot, "dist", "server", "index.js");

function collectSourceFiles(directory) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolutePath);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [absolutePath] : [];
  });
}

const sourceFiles = ["app", "components", "hooks", "lib"]
  .flatMap((directory) => collectSourceFiles(path.join(projectRoot, directory)));
const sources = new Map(
  sourceFiles.map((file) => [path.relative(projectRoot, file), readFileSync(file, "utf8")]),
);
const allSource = [...sources.values()].join("\n");
const uiSource = [...sources]
  .filter(([file]) => /^(?:app|components)[\\/].*\.tsx$/.test(file))
  .map(([, source]) => source)
  .join("\n");

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function requireSemantic(value, label, patterns) {
  assert.ok(
    matchesAny(value, patterns),
    `${label} 계약을 찾지 못했습니다. 허용되는 의미 표식 중 하나를 UI/상태 소스에 추가하세요.`,
  );
}

async function fetchApplication(request) {
  const workerUrl = pathToFileURL(builtWorkerPath);
  workerUrl.searchParams.set("workflow-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("exposes the three operational roles and a report review surface", () => {
  requireSemantic(uiSource, "구급대원 모바일", [
    /MobileApp/,
    /paramedic/i,
    /구급대원/,
  ]);
  requireSemantic(uiSource, "이송조정 상황실", [
    /ControlConsole/,
    /dispatch\s*(?:center|console)/i,
    /상황실/,
  ]);
  requireSemantic(uiSource, "병원 수용 화면", [
    /HospitalConsole/,
    /hospital\s*(?:console|portal)/i,
    /병원\s*(?:수용|회신|인수)/,
  ]);
  requireSemantic(uiSource, "완료 후 보고서 화면", [
    /Report(?:Draft|Review|Screen|Console)/,
    /report[-_ ]?(?:draft|review)/i,
    /(?:구급활동일지|응급구조[^\n]{0,12}보고서|보고서)\s*(?:작성|초안|검토)/,
  ]);
});

test("wires authenticated role routes, microphone PTT, and authoritative realtime refresh", () => {
  for (const route of ["app/paramedic/page.tsx", "app/control/page.tsx", "app/hospital/page.tsx", "app/reports/page.tsx"]) {
    assert.ok([...sources.keys()].some((file) => file.replaceAll("\\", "/") === route), `${route} 역할 경로가 없습니다.`);
  }
  const source = (wanted) => [...sources].find(([file]) => file.replaceAll("\\", "/") === wanted)?.[1] ?? "";
  const ptt = source("hooks/useTranscribePtt.ts");
  assert.match(ptt, /getUserMedia/);
  assert.match(ptt, /createTranscribeSession/);
  assert.match(ptt, /encodeAudioEvent/);
  const provider = source("components/DemoContext.tsx");
  assert.match(provider, /case\.invalidated/);
  assert.match(provider, /getCaseSnapshot/);
  assert.match(provider, /expectedVersion/);
  const auth = source("lib/cognitoAuth.ts");
  assert.match(auth, /code_challenge_method/);
  assert.match(auth, /cognito:groups/);
});

test("covers the end-to-end case lifecycle without coupling to display copy", () => {
  const lifecycleContracts = [
    ["출동 배정", [/\bassigned\b/i, /dispatch[-_ ]?assigned/i, /출동\s*배정/]],
    ["현장 이동", [/\benroute\b/i, /en[-_ ]?route/i, /출동\s*중/]],
    ["현장 도착", [/scene[-_ ]?arrived/i, /on[-_ ]?scene/i, /현장\s*도착/]],
    ["환자 접촉·평가", [/patient[-_ ]?contact/i, /assess(?:ing|ment)/i, /환자\s*접촉/]],
    ["병원 문의", [/hospital[-_ ]?(?:requested|inquiry)/i, /inquiry[-_ ]?sent/i, /수용\s*문의/]],
    ["이송", [/\btransporting\b/i, /transport[-_ ]?started/i, /이송\s*(?:시작|중)/]],
    ["병원 인계", [/handoff[-_ ]?(?:sent|complete)/i, /인계\s*(?:완료|확인)/]],
    ["보고서 작성·검토", [/report[-_ ]?(?:draft|review|ready)/i, /보고서\s*(?:초안|작성|검토)/]],
    ["사건 종료", [/\bclosed\b/i, /case[-_ ]?complete/i, /사건\s*종료/]],
  ];

  for (const [label, patterns] of lifecycleContracts) {
    requireSemantic(allSource, label, patterns);
  }
});

test("models all hospital reply branches and keeps destination confirmation separate", () => {
  const branchContracts = [
    ["추가정보 요청", [/info[-_ ]?requested/i, /request[-_ ]?info/i, /추가정보\s*요청/]],
    ["수용 가능", [/\baccepted\b/i, /hospital[-_ ]?accept/i, /수용\s*가능/]],
    ["수용 곤란", [/\bdeclined\b/i, /hospital[-_ ]?decline/i, /수용\s*곤란/]],
  ];

  for (const [label, patterns] of branchContracts) {
    requireSemantic(allSource, label, patterns);
  }

  requireSemantic(allSource, "병원 회신 이후 별도 이송지 확정", [
    /destination[-_ ]?confirmed/i,
    /confirm[-_ ]?destination/i,
    /이송지\s*(?:확정|확인)/,
  ]);

  assert.doesNotMatch(
    allSource,
    /(?:ai|agent)[A-Za-z0-9_]*(?:auto|direct)[A-Za-z0-9_]*(?:accept|destination)/i,
    "AI가 병원 수용 또는 이송지를 직접 확정하는 식별자를 사용하면 안 됩니다.",
  );
});

test("represents uncertain clinical facts without a concrete demo fallback", () => {
  requireSemantic(allSource, "미확인·미상 상태", [
    /\bunknown\b/i,
    /not[-_ ]?(?:assessed|known|available)/i,
    /미상|미확인|평가\s*불가/,
  ]);
  requireSemantic(allSource, "사람 확인 전 변경안", [
    /\bproposal\b|\bproposed\b/i,
    /pending[-_ ]?review/i,
    /변경안|확인\s*대기|검토\s*필요/,
  ]);

  const extractionSources = [...sources]
    .filter(([file]) => /agent|voice|speech|transcrib/i.test(file))
    .map(([, source]) => source)
    .join("\n");

  assert.doesNotMatch(
    extractionSources,
    /demo[-_ ]?fallback/i,
    "인식하지 못한 임상값을 시연용 값으로 채우지 마세요. null/unknown과 확인 필요 상태를 반환해야 합니다.",
  );
});

test("rendered shell exposes role navigation", { skip: !existsSync(builtWorkerPath) }, async () => {
  const response = await fetchApplication(
    new Request("http://localhost/demo/workflow?view=workflow", { headers: { accept: "text/html" } }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /EMS Relay/i);
  requireSemantic(html, "렌더된 구급대원 역할", [/구급대/, /paramedic/i]);
  requireSemantic(html, "렌더된 상황실 역할", [/상황실/, /dispatch/i]);
  requireSemantic(html, "렌더된 병원 역할", [/병원/, /hospital/i]);
});

test("agent API does not invent values for an uninformative utterance", { skip: !existsSync(builtWorkerPath) }, async () => {
  const response = await fetchApplication(
    new Request("http://localhost/api/local/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case_id: "GW-CARDIO-050", updateId: "GW-CARDIO-050-U01", transcript: "환자 상태를 확인하고 있습니다." }),
    }),
  );
  assert.equal(response.status, 422);

  const payload = await response.json();
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /demo[-_ ]?fallback/i);
  assert.equal(payload.error, "unsupported_local_transcript");

  const result = payload?.data ?? payload;
  const structured = result?.structured;
  if (structured && typeof structured === "object") {
    const unknownValue = (value) => value == null
      || value === ""
      || (typeof value === "string" && /^(?:unknown|미상|미확인|not[_ -]?assessed|평가 불가)$/i.test(value.trim()));
    for (const [field, value] of Object.entries(structured)) {
      assert.ok(
        unknownValue(value),
        `정보가 없는 발화에서 ${field}=${JSON.stringify(value)} 값을 생성했습니다. 값은 null/unknown이어야 합니다.`,
      );
    }
  }

  const proposals = Array.isArray(result?.proposed_updates) ? result.proposed_updates : [];
  assert.ok(
    proposals.every((proposal) => !/^(?:confirmed|확정)$/i.test(String(proposal?.fact_status ?? proposal?.status ?? ""))),
    "Agent 응답이 사람 확인 없이 confirmed 상태를 반환하면 안 됩니다.",
  );
});

test("hospital directory is reference data, not an acceptance decision", { skip: !existsSync(builtWorkerPath) }, async () => {
  const response = await fetchApplication(
    new Request("http://localhost/api/local/hospitals", { headers: { accept: "application/json" } }),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.hospitals) && payload.hospitals.length > 0);

  for (const hospital of payload.hospitals) {
    const keys = Object.keys(hospital);
    assert.ok(!keys.some((key) => /^(?:accepted|acceptance|realtimeAcceptance|autoRecommended)$/i.test(key)));
  }
});

test("operational workspaces start empty and never merge the cardiovascular demo fixture", () => {
  const source = (wanted) => [...sources].find(([file]) => file.replaceAll("\\", "/") === wanted)?.[1] ?? "";
  const provider = source("components/DemoContext.tsx");
  const mobile = source("components/MobileApp.tsx");
  const workspace = source("components/OperationalWorkspace.tsx");
  const report = source("components/ReportConsole.tsx");

  assert.match(provider, /value:\s*operational\s*\?\s*operationalInitialState\(\)\s*:\s*initialState\(\)/);
  assert.match(provider, /operational\s*\?\s*createOperationalScenario\(caseId\)\s*:\s*SCENARIO/);
  assert.match(provider, /operational\s*\?\s*\[\]\s*:\s*HOSPITALS/);
  assert.match(provider, /mode:\s*remoteEnabled\s*\?\s*"remote"\s*:\s*operational\s*\?\s*"operational"\s*:\s*"demo"/);
  assert.match(provider, /if\s*\(operational\)\s*\{\s*hydratedRef\.current\s*=\s*true;\s*return;/);
  assert.match(provider, /if\s*\(operational\s*\|\|\s*remoteEnabled\s*\|\|\s*!hydratedRef\.current/);

  const scenarioStart = provider.indexOf("function snapshotToScenario");
  const stateStart = provider.indexOf("function snapshotToState", scenarioStart);
  const commandStart = provider.indexOf("function commandForAction", stateStart);
  const operationalSnapshotCode = provider.slice(scenarioStart, commandStart);
  assert.ok(scenarioStart >= 0 && stateStart > scenarioStart && commandStart > stateStart);
  assert.doesNotMatch(operationalSnapshotCode, /CARDIO_DEMO_|\bSCENARIO\b|\bHOSPITALS\b/);
  assert.match(operationalSnapshotCode, /const empty = createOperationalScenario\(snapshot\.caseId\)/);
  assert.match(operationalSnapshotCode, /const empty = operationalInitialState\(\)/);
  assert.match(operationalSnapshotCode, /:\s*\[\];/);

  assert.match(mobile, /operational\s*\?\s*createOperationalPttUpdates/);
  assert.match(mobile, /operational\s*\?\s*\{\s*bp:\s*""/);
  assert.match(mobile, /SCENARIO\.interventions\.join\(" · "\)\s*\|\|\s*\(operational\s*\?\s*"기록 없음"/);
  assert.doesNotMatch(mobile, /`AVPU A · BP \$\{state\.reassessmentVitals/);
  assert.doesNotMatch(workspace, /import\s*\{[^}]*\bSCENARIO\b[^}]*\}\s*from\s*"\.\/DemoContext"/);
  assert.match(workspace, /NEXT_PUBLIC_EMS_DEFAULT_CASE_ID\?\.trim\(\)\s*\|\|\s*"UNASSIGNED"/);
  assert.match(report, /if\s*\(sync\.mode\s*===\s*"demo"\)\s*return\s*DEMO_UNKNOWN_ITEMS/);
});

test("the explicit demo workflow always uses the local voice proposal endpoint", () => {
  const source = (wanted) => [...sources].find(([file]) => file.replaceAll("\\", "/") === wanted)?.[1] ?? "";
  const api = source("lib/emsApi.ts");
  const mobile = source("components/MobileApp.tsx");

  assert.match(api, /if\s*\(options\?\.forceLocal\)\s*return\s*request\("local"\);/);
  assert.match(mobile, /forceLocal:\s*!operational/);
  assert.match(api, /localPath:\s*"agent"/);
});

test("a hospital without an assigned request sees an idle queue instead of an access error", () => {
  const source = (wanted) => [...sources].find(([file]) => file.replaceAll("\\", "/") === wanted)?.[1] ?? "";
  const provider = source("components/DemoContext.tsx");
  const workspace = source("components/OperationalWorkspace.tsx");
  const hospital = source("components/HospitalConsole.tsx");

  assert.match(workspace, /operationalRole=\{operationalRole\}/);
  assert.match(provider, /const\s+quietForbiddenAsWaiting\s*=\s*operationalRole\s*===\s*"hospital"/);
  assert.match(provider, /quietForbiddenAsWaiting\s*&&\s*error\s+instanceof\s+EmsApiError\s*&&\s*error\.status\s*===\s*403/);
  assert.match(provider, /setWaitingForRequest\(true\);\s*setSyncError\(null\);/);
  assert.match(provider, /setConnection\("error"\);\s*setWaitingForRequest\(false\);\s*setSyncError\(error\s+instanceof\s+Error/);
  assert.match(provider, /if\s*\(!remoteEnabled\s*\|\|\s*operationalRole\s*!==\s*"paramedic"\)\s*return;/);
  assert.match(provider, /nextConnection\s*===\s*"connected"\)\s*void\s+refresh\(\)/);
  assert.match(hospital, /sync\.waitingForRequest\s*\?\s*"요청 대기"/);
});
