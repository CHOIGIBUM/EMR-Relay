import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isV2NetworkHospitalId,
  V2_HOSPITAL_NETWORK_ID,
  V2_NETWORK_HOSPITAL_IDS,
} from "../lib/v2/hospitalDirectory.ts";

const hospitalAppSource = readFileSync(new URL("../components/v2/HospitalApp.tsx", import.meta.url), "utf8");
const brandSource = readFileSync(new URL("../components/v2/Brand.tsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../components/v2/V2Provider.tsx", import.meta.url), "utf8");
const paramedicAppSource = readFileSync(new URL("../components/v2/ParamedicApp.tsx", import.meta.url), "utf8");

test("the NETWORK demo account can switch only among hospitals returned for the three demo scenes", () => {
  assert.equal(V2_HOSPITAL_NETWORK_ID, "NETWORK");
  assert.deepEqual(V2_NETWORK_HOSPITAL_IDS, [
    "A2200012", "A2200046", "A2200010", "A2200011", "A2200005",
    "A2200008", "A2200038", "A2200003", "A2200007",
  ]);
  assert.equal(isV2NetworkHospitalId("A2200012"), true);
  assert.equal(isV2NetworkHospitalId("A2200046"), true);
  assert.equal(isV2NetworkHospitalId("A2200011"), true);
  assert.equal(isV2NetworkHospitalId("A2200003"), true);
  assert.equal(isV2NetworkHospitalId("A2200099"), false);
  assert.equal(isV2NetworkHospitalId("NETWORK"), false);
});

test("ordinary hospital accounts remain fixed while NETWORK gets the explicit switcher", () => {
  assert.match(hospitalAppSource, /isNetworkAccount\s*=\s*accountHospitalId\s*===\s*V2_HOSPITAL_NETWORK_ID/);
  assert.match(hospitalAppSource, /if \(!isNetworkAccount \|\| !isV2NetworkHospitalId\(nextHospitalId\)\) return/);
  assert.match(hospitalAppSource, /\.\.\.\(isNetworkAccount \? \{[\s\S]*?options:[\s\S]*?onChange: changeHospital/);
  assert.match(providerSource, /hospitalAccountId !== V2_HOSPITAL_NETWORK_ID && hospitalId !== hospitalAccountId/);
});

test("switching hospitals clears stale review state and moves the realtime scope", () => {
  const switchStart = hospitalAppSource.indexOf("const changeHospital");
  const switchEnd = hospitalAppSource.indexOf("}, [isNetworkAccount, selectHospitalRealtimeScope]);", switchStart);
  const switchBody = hospitalAppSource.slice(switchStart, switchEnd);
  assert.match(switchBody, /activeHospitalId\.current = nextHospitalId/);
  assert.match(switchBody, /setInbox\(\[\]\)/);
  assert.match(switchBody, /setSelectedRequestId\(null\)/);
  assert.match(switchBody, /setDecision\(null\)/);
  assert.match(switchBody, /selectHospitalRealtimeScope\(nextHospitalId\)/);
  assert.match(hospitalAppSource, /sequence !== inboxLoadSequence\.current \|\| activeHospitalId\.current !== requestedHospitalId/);
  assert.match(providerSource, /hospitalAccountId === V2_HOSPITAL_NETWORK_ID[\s\S]*?DEFAULT_V2_HOSPITAL_ID/);
  assert.match(providerSource, /const hospitalId = hospitalRealtimeHospitalId/);
});

test("the current hospital appears in an accessible header control before logout", () => {
  assert.match(brandSource, /aria-label={`현재 병원 \$\{hospitalContext\.name\}`}/);
  assert.match(brandSource, /aria-label="담당 병원 전환"/);
  assert.ok(brandSource.indexOf("styles.hospitalAccount") < brandSource.indexOf("styles.logout"));
  assert.match(brandSource, /hospitalContext \? <div/);
  assert.doesNotMatch(paramedicAppSource, /hospitalContext=/);
});
