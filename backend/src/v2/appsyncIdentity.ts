import { AuthenticationError, AuthorizationError } from "../auth.js";
import { resolveHospitalForPrincipal } from "../hospitalScope.js";
import type { AuthPrincipal, PrincipalRole } from "../types.js";

export type AppSyncIdentity = Record<string, unknown> | null | undefined;

function parseGroups(value: unknown): PrincipalRole[] {
  let candidates: unknown[] = [];
  if (Array.isArray(value)) candidates = value;
  else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      candidates = Array.isArray(parsed) ? parsed : value.replace(/^\[|\]$/g, "").split(",");
    } catch {
      candidates = value.replace(/^\[|\]$/g, "").split(",");
    }
  }
  const allowed = new Set<string>(["paramedic", "hospital"]);
  return [...new Set(
    candidates
      .map((entry) => String(entry).trim())
      .filter((entry): entry is PrincipalRole => allowed.has(entry)),
  )];
}

export function isIamIdentity(identity: AppSyncIdentity) {
  return Boolean(identity && (typeof identity.userArn === "string" || typeof identity.accountId === "string"));
}

export function principalFromAppSyncIdentity(identity: AppSyncIdentity): AuthPrincipal {
  if (!identity || typeof identity !== "object") throw new AuthenticationError();
  const claims = identity.claims && typeof identity.claims === "object"
    ? identity.claims as Record<string, unknown>
    : {};
  const sub = typeof claims.sub === "string"
    ? claims.sub.trim()
    : typeof identity.sub === "string"
      ? identity.sub.trim()
      : "";
  if (!sub) throw new AuthenticationError();
  const roles = parseGroups(claims["cognito:groups"]);
  if (!roles.length) throw new AuthorizationError("EMS Relay 사용자 역할이 필요합니다.");
  const username = typeof claims["cognito:username"] === "string"
    ? claims["cognito:username"]
    : typeof identity.username === "string" ? identity.username : undefined;
  const hospitalId = typeof claims["custom:hospital_id"] === "string"
    ? claims["custom:hospital_id"].trim()
    : undefined;
  return { sub, roles, ...(username ? { username } : {}), ...(hospitalId ? { hospitalId } : {}) };
}

export function resolveHospitalScope(principal: AuthPrincipal, requestedHospitalId?: string): string {
  return resolveHospitalForPrincipal(principal, requestedHospitalId);
}

export function parseAwsJson(value: unknown, label = "AWSJSON") {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") throw new Error(`${label}은 JSON 객체여야 합니다.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label}을 JSON으로 해석할 수 없습니다.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}은 JSON 객체여야 합니다.`);
  }
  return parsed as Record<string, unknown>;
}
