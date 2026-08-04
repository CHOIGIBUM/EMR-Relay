import { APP_ROLES, isAppRole, type AppRole } from "@/lib/authRole";
import { DEFAULT_V2_HOSPITAL_ID } from "@/lib/v2/hospitalDirectory";

const TOKEN_KEY = "ems-relay:cognito-session:v1";
const VERIFIER_KEY = "ems-relay:cognito-pkce:v1";
const RETURN_KEY = "ems-relay:cognito-return:v1";
const STATE_KEY = "ems-relay:cognito-state:v1";
const NONCE_KEY = "ems-relay:cognito-nonce:v1";
const DEV_ROLE_KEY = "ems-relay:development-role:v1";

const domain = (process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "").replace(/\/+$/, "");
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
const configuredRedirect = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ?? "";
const configuredLogout = process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI ?? "";
const devAuthEnabled = process.env.NEXT_PUBLIC_EMS_DEV_AUTH === "true";

type TokenSet = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: "Bearer";
  obtained_at: number;
};

export type AuthenticatedUser = {
  subject: string;
  displayName: string;
  email: string;
  roles: AppRole[];
  institutionId: string | null;
  accessToken: string | null;
  expiresAt: number | null;
  development: boolean;
};

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rolesFromClaims(claims: Record<string, unknown>): AppRole[] {
  const groups = Array.isArray(claims["cognito:groups"])
    ? claims["cognito:groups"].filter((group): group is string => typeof group === "string")
    : [];
  const candidates = new Set(groups.map((group) => group.toLowerCase().replace(/^ems[-_:]/, "")));
  return APP_ROLES.filter((role) => candidates.has(role));
}

function tokenUser(tokens: TokenSet): AuthenticatedUser | null {
  const claims = decodeJwt(tokens.id_token);
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) return null;
  const roles = rolesFromClaims(claims);
  return {
    subject,
    displayName: typeof claims.name === "string" ? claims.name : typeof claims.email === "string" ? claims.email : "사용자",
    email: typeof claims.email === "string" ? claims.email : "",
    roles,
    institutionId: typeof claims["custom:hospital_id"] === "string"
      ? claims["custom:hospital_id"]
      : typeof claims["custom:institution_id"] === "string"
        ? claims["custom:institution_id"]
        : null,
    // API Gateway validates this token's audience. The ID token also carries
    // the read-only custom:hospital_id used for hospital object authorization.
    accessToken: tokens.id_token,
    expiresAt: tokens.obtained_at + tokens.expires_in * 1000,
    development: false,
  };
}

function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return base64Url(bytes);
}

function randomToken(size = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function redirectUri() {
  return configuredRedirect || `${window.location.origin}/auth/callback`;
}

export function isCognitoConfigured() {
  return Boolean(domain && clientId);
}

export function isDevelopmentAuthEnabled() {
  return devAuthEnabled;
}

export async function startCognitoSignIn(returnTo = "/") {
  if (!isCognitoConfigured()) throw new Error("로그인 설정이 준비되지 않았습니다.");
  const verifier = randomVerifier();
  const state = randomToken();
  const nonce = randomToken();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  sessionStorage.setItem(RETURN_KEY, safeReturnTo(returnTo));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    state,
    nonce,
  });
  window.location.assign(`${domain}/oauth2/authorize?${params.toString()}`);
}

export async function completeCognitoSignIn(code: string, returnedState: string) {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const expectedNonce = sessionStorage.getItem(NONCE_KEY);
  const returnTo = safeReturnTo(sessionStorage.getItem(RETURN_KEY));
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (!verifier || !expectedState || !expectedNonce || !returnedState || !constantTimeEqual(expectedState, returnedState) || !isCognitoConfigured()) {
    throw new Error("로그인 요청을 확인할 수 없습니다. 다시 로그인해 주세요.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const response = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("로그인을 완료하지 못했습니다.");
  const raw = await response.json() as Omit<TokenSet, "obtained_at">;
  const tokens: TokenSet = { ...raw, obtained_at: Date.now() };
  const idClaims = decodeJwt(tokens.id_token);
  if (typeof idClaims.nonce !== "string" || !constantTimeEqual(idClaims.nonce, expectedNonce)) {
    throw new Error("로그인 응답을 확인할 수 없습니다. 다시 로그인해 주세요.");
  }
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  const user = tokenUser(tokens);
  if (!user) throw new Error("사용자 정보를 확인하지 못했습니다.");
  return { user, returnTo };
}

function readTokens(): TokenSet | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null") as TokenSet | null;
    return parsed?.access_token && parsed.id_token ? parsed : null;
  } catch {
    return null;
  }
}

async function refreshTokens(tokens: TokenSet): Promise<TokenSet | null> {
  if (!tokens.refresh_token || !isCognitoConfigured()) return null;
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(`${domain}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) return null;
  const next = await response.json() as Partial<TokenSet>;
  const refreshed: TokenSet = {
    access_token: next.access_token ?? tokens.access_token,
    id_token: next.id_token ?? tokens.id_token,
    refresh_token: tokens.refresh_token,
    expires_in: next.expires_in ?? tokens.expires_in,
    token_type: "Bearer",
    obtained_at: Date.now(),
  };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(refreshed));
  return refreshed;
}

export async function restoreAuthenticatedUser() {
  if (devAuthEnabled) {
    const role = sessionStorage.getItem(DEV_ROLE_KEY);
    if (isAppRole(role)) {
      return { subject: `development-${role}`, displayName: "개발 사용자", email: "", roles: [role], institutionId: role === "hospital" ? DEFAULT_V2_HOSPITAL_ID : null, accessToken: null, expiresAt: null, development: true } satisfies AuthenticatedUser;
    }
  }
  let tokens = readTokens();
  if (!tokens) return null;
  if (tokens.obtained_at + tokens.expires_in * 1000 < Date.now() + 60_000) tokens = await refreshTokens(tokens);
  return tokens ? tokenUser(tokens) : null;
}

export async function currentAccessToken() {
  let tokens = readTokens();
  if (!tokens) return null;
  if (tokens.obtained_at + tokens.expires_in * 1000 < Date.now() + 60_000) {
    tokens = await refreshTokens(tokens);
  }
  return tokens?.id_token ?? null;
}

export function chooseDevelopmentRole(role: AppRole) {
  if (!devAuthEnabled) throw new Error("개발 로그인이 허용되지 않았습니다.");
  sessionStorage.setItem(DEV_ROLE_KEY, role);
}

export function signOutCognito() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(DEV_ROLE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (isCognitoConfigured()) {
    const logoutUri = configuredLogout || `${window.location.origin}/login`;
    window.location.assign(`${domain}/logout?${new URLSearchParams({ client_id: clientId, logout_uri: logoutUri }).toString()}`);
  } else {
    window.location.assign("/login");
  }
}
