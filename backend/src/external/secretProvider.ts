import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export type ExternalApiSecrets = {
  NMC_SERVICE_KEY?: string;
  NMC_BASE_URL?: string;
  NMC_REALTIME_BASE_URL?: string;
  HIRA_SERVICE_KEY?: string;
  HIRA_BASE_URL?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_DIRECTIONS_URL?: string;
  KMA_SERVICE_KEY?: string;
  KMA_ULTRA_SRT_URL?: string;
};

const SECRET_NAME = process.env.EXTERNAL_API_SECRET_NAME || "ems-relay/external-api-keys";
const client = new SecretsManagerClient({});
let cached: Promise<ExternalApiSecrets> | undefined;

function parseSecret(value: string): ExternalApiSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("EXTERNAL_API_SECRET_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("EXTERNAL_API_SECRET_INVALID_JSON");
  const source = parsed as Record<string, unknown>;
  const allowed = [
    "NMC_SERVICE_KEY",
    "NMC_BASE_URL",
    "NMC_REALTIME_BASE_URL",
    "HIRA_SERVICE_KEY",
    "HIRA_BASE_URL",
    "KAKAO_REST_API_KEY",
    "KAKAO_DIRECTIONS_URL",
    "DATA_GO_KR_SERVICE_KEY_DECODED",
    "DATA_GO_KR_SERVICE_KEY_ENCODED",
    "KAKAO_MOBILITY_REST_API_KEY",
    "KMA_SERVICE_KEY",
    "KMA_ULTRA_SRT_URL",
  ] as const;
  const values: Record<string, string> = {};
  for (const key of allowed) {
    const entry = source[key];
    if (entry !== undefined && (typeof entry !== "string" || !entry.trim())) throw new Error(`EXTERNAL_API_SECRET_INVALID_${key}`);
    if (typeof entry === "string") values[key] = entry.trim();
  }
  const publicDataKey = values.DATA_GO_KR_SERVICE_KEY_DECODED ?? values.DATA_GO_KR_SERVICE_KEY_ENCODED;
  return {
    ...(values.NMC_SERVICE_KEY || publicDataKey ? { NMC_SERVICE_KEY: values.NMC_SERVICE_KEY ?? publicDataKey } : {}),
    ...(values.HIRA_SERVICE_KEY || publicDataKey ? { HIRA_SERVICE_KEY: values.HIRA_SERVICE_KEY ?? publicDataKey } : {}),
    ...(values.NMC_BASE_URL ? { NMC_BASE_URL: values.NMC_BASE_URL } : {}),
    ...(values.NMC_REALTIME_BASE_URL ? { NMC_REALTIME_BASE_URL: values.NMC_REALTIME_BASE_URL } : {}),
    ...(values.HIRA_BASE_URL ? { HIRA_BASE_URL: values.HIRA_BASE_URL } : {}),
    ...(values.KAKAO_REST_API_KEY || values.KAKAO_MOBILITY_REST_API_KEY
      ? { KAKAO_REST_API_KEY: values.KAKAO_REST_API_KEY ?? values.KAKAO_MOBILITY_REST_API_KEY }
      : {}),
    ...(values.KAKAO_DIRECTIONS_URL ? { KAKAO_DIRECTIONS_URL: values.KAKAO_DIRECTIONS_URL } : {}),
    ...(values.KMA_SERVICE_KEY || publicDataKey ? { KMA_SERVICE_KEY: values.KMA_SERVICE_KEY ?? publicDataKey } : {}),
    ...(values.KMA_ULTRA_SRT_URL ? { KMA_ULTRA_SRT_URL: values.KMA_ULTRA_SRT_URL } : {}),
  };
}

export async function getExternalApiSecrets() {
  cached ??= client.send(new GetSecretValueCommand({ SecretId: SECRET_NAME })).then((response) => {
    if (!response.SecretString) throw new Error("EXTERNAL_API_SECRET_EMPTY");
    return parseSecret(response.SecretString);
  }).catch((error) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

export function resetSecretCacheForTests() {
  cached = undefined;
}
