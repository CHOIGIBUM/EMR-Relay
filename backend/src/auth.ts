import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PRINCIPAL_ROLES, type AuthPrincipal, type CaseEventType, type PrincipalRole } from "./types.js";

type JwtContext = {
  claims?: Record<string, string | number | boolean | string[]>;
  scopes?: string[];
};

export class AuthenticationError extends Error {
  constructor(message = "인증이 필요합니다.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "이 작업을 수행할 권한이 없습니다.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function jwtContext(event: APIGatewayProxyEventV2): JwtContext | undefined {
  const context = event.requestContext as APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: { jwt?: JwtContext };
  };
  return context.authorizer?.jwt;
}

function parseGroups(value: unknown): PrincipalRole[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/^\[|\]$/g, "").split(",")
      : [];
  const allowed = new Set<string>(PRINCIPAL_ROLES);
  return [...new Set(values.map((entry) => String(entry).trim()).filter((entry): entry is PrincipalRole => allowed.has(entry)))];
}

export function principalFromEvent(event: APIGatewayProxyEventV2): AuthPrincipal {
  const claims = jwtContext(event)?.claims ?? {};
  const sub = typeof claims?.sub === "string" ? claims.sub.trim() : "";
  if (!sub) throw new AuthenticationError();

  const roles = parseGroups(claims["cognito:groups"]);
  if (roles.length === 0) throw new AuthorizationError("EMS Relay 역할이 부여되지 않았습니다.");
  const username = typeof claims["cognito:username"] === "string" ? claims["cognito:username"] : undefined;
  const hospitalId = typeof claims["custom:hospital_id"] === "string" ? claims["custom:hospital_id"].trim() : undefined;
  return { sub, roles, ...(username ? { username } : {}), ...(hospitalId ? { hospitalId } : {}) };
}

export function primaryRole(principal: AuthPrincipal): PrincipalRole {
  return principal.roles.includes("admin") ? "admin" : principal.roles[0] ?? "paramedic";
}

export function requireRole(principal: AuthPrincipal, ...roles: PrincipalRole[]) {
  if (principal.roles.includes("admin") || roles.some((role) => principal.roles.includes(role))) return;
  throw new AuthorizationError();
}

const PARAMEDIC_EVENTS = new Set<CaseEventType>([
  "DISPATCH_STARTED",
  "ARRIVED_SCENE",
  "PATIENT_CONTACT",
  "PATIENT_FACTS_CONFIRMED",
  "HOSPITAL_REQUEST_CREATED",
  "ADDITIONAL_INFO_SENT",
  "DESTINATION_CONFIRMED_BY_PARAMEDIC",
  "TRANSPORT_STARTED",
  "REASSESSMENT_CONFIRMED",
  "ARRIVED_HOSPITAL",
  "HANDOFF_SENT",
]);

const HOSPITAL_EVENTS = new Set<CaseEventType>([
  "HOSPITAL_REQUEST_VIEWED",
  "ADDITIONAL_INFO_REQUESTED",
  "HOSPITAL_RESPONSE_RECORDED",
  "HANDOFF_ACCEPTED",
]);

export function authorizeCommand(principal: AuthPrincipal, type: CaseEventType) {
  if (principal.roles.includes("admin")) return;
  if (type === "CASE_ASSIGNED") return requireRole(principal, "control");
  if (PARAMEDIC_EVENTS.has(type)) return requireRole(principal, "paramedic");
  if (HOSPITAL_EVENTS.has(type)) return requireRole(principal, "hospital");
  if (["REPORT_DRAFTED", "REPORT_REVIEWED", "REPORT_FINALIZED", "FHIR_PUBLISHED"].includes(type)) {
    throw new AuthorizationError("이 이벤트는 전용 서버 작업에서만 생성할 수 있습니다.");
  }
  throw new AuthorizationError();
}
