import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function staticPagePath(route) {
  const segments = route.split("?")[0].split("/").filter(Boolean);
  return path.join(projectRoot, "out", ...segments, "index.html");
}

function readStaticPage(route) {
  return readFileSync(staticPagePath(route), "utf8");
}

const exportedRoutes = ["/", "/login", "/auth/callback", "/paramedic", "/hospital"];

test("exports the five Seoul v2 application routes for Amplify", () => {
  for (const route of exportedRoutes) {
    const outputPath = staticPagePath(route);
    assert.equal(existsSync(outputPath), true, `missing static export: ${route}`);

    const html = readStaticPage(route);
    assert.match(html, /<html[^>]+lang="ko"/i);
    assert.match(html, /EMS Relay/i);
    assert.match(html, /ems-relay-icon\.png/i);
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  }
});

test("routes users only through the v2 role application", () => {
  const routeContracts = [
    ["app/page.tsx", /LoginScreen/],
    ["app/login/page.tsx", /LoginScreen/],
    ["app/auth/callback/page.tsx", /CallbackScreen/],
    ["app/paramedic/page.tsx", /<V2RolePage role="paramedic"\s*\/>/],
    ["app/hospital/page.tsx", /<V2RolePage role="hospital"\s*\/>/],
  ];

  for (const [relativePath, expected] of routeContracts) {
    const source = readProjectFile(relativePath);
    assert.match(source, expected, relativePath);
    assert.doesNotMatch(source, /OperationalWorkspace|EMSRelayApp|DemoProvider/, relativePath);
  }
});

test("does not export removed control, report, or demo applications", () => {
  for (const route of ["/control", "/reports", "/demo/workflow", "/demo/stroke", "/demo/stroke/paramedic", "/demo/stroke/hospital"]) {
    assert.equal(existsSync(staticPagePath(route)), false, `legacy route was exported: ${route}`);
  }
});

test("keeps production metadata on every v2 static shell", () => {
  const rootHtml = readStaticPage("/");
  assert.match(rootHtml, /<title>EMS Relay/i);
  assert.match(rootHtml, /main\.d1b1dqlcfz85e3\.amplifyapp\.com\/og\.png/i);
  assert.match(rootHtml, /manifest\.webmanifest/i);
});
