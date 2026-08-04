import type { AuthPrincipal, CaseEventType, PrincipalRole } from "./types.js";

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

export function primaryRole(principal: AuthPrincipal): PrincipalRole {
  if (principal.roles.includes("paramedic")) return "paramedic";
  if (principal.roles.includes("hospital")) return "hospital";
  throw new AuthorizationError("EMS Relay 사용자 역할이 필요합니다.");
}

export function requireRole(principal: AuthPrincipal, ...roles: PrincipalRole[]) {
  if (roles.some((role) => principal.roles.includes(role))) return;
  throw new AuthorizationError();
}

const PARAMEDIC_EVENTS = new Set<CaseEventType>([
  "DISPATCH_STARTED",
  "ARRIVED_SCENE",
  "PATIENT_CONTACT",
  "PATIENT_FACTS_CONFIRMED",
  "HOSPITAL_BROADCAST_STARTED",
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
  if (PARAMEDIC_EVENTS.has(type)) return requireRole(principal, "paramedic");
  if (HOSPITAL_EVENTS.has(type)) return requireRole(principal, "hospital");
  throw new AuthorizationError();
}
