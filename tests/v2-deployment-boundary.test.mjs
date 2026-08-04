import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployScript = readFileSync(
  new URL("../scripts/deploy-seoul-v2.ps1", import.meta.url),
  "utf8",
);

test("Seoul v2 deployment uses only system or explicitly selected Python", () => {
  assert.doesNotMatch(deployScript, /agentcore[\\/]+\.venv/i);
  assert.doesNotMatch(deployScript, /\$BundledPython/);
  assert.match(deployScript, /\[string\]\$PythonCommand\s*=\s*"python"/);
  assert.match(deployScript, /Assert-Command \$PythonCommand/);
  assert.match(
    deployScript,
    /& \$PythonCommand \(Join-Path \$PSScriptRoot "configure_amplify\.py"\)/,
  );
});
