import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

const ENDPOINT = process.env.GRAPHQL_ENDPOINT || "";
const REGION = process.env.AWS_REGION || "ap-northeast-2";
const signer = new SignatureV4({ credentials: defaultProvider(), region: REGION, service: "appsync", sha256: Hash.bind(null, "sha256") });

async function publish(query: string, variables: Record<string, unknown>) {
  if (!ENDPOINT) return;
  const url = new URL(ENDPOINT);
  const body = JSON.stringify({ query, variables });
  const request = new HttpRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    method: "POST",
    path: url.pathname,
    headers: { host: url.hostname, "content-type": "application/json", accept: "application/json" },
    body,
  });
  const signed = await signer.sign(request);
  const response = await fetch(ENDPOINT, { method: "POST", headers: signed.headers as Record<string, string>, body });
  const result = await response.json() as { errors?: Array<{ message?: string }> };
  if (!response.ok || result.errors?.length) {
    throw new Error(`AppSync publish failed: ${result.errors?.map((item) => item.message).filter(Boolean).join("; ") || response.status}`);
  }
}

export async function publishCaseUpdate(input: Record<string, unknown>) {
  return publish(
    `mutation PublishCaseUpdate($input: CaseUpdateInput!) {
      publishCaseUpdate(input: $input) { caseId version eventId eventType stage occurredAt requestId hospitalId requestStatus }
    }`,
    { input },
  );
}
