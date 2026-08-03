import type { LocalHealthResponse } from "@/lib/localDemoTypes";

export async function GET(): Promise<Response> {
  const response: LocalHealthResponse = {
    status: "ok",
    mode: "local-mock",
    services: {
      agent: {
        status: "available",
        provider: "scripted-proposal-contract",
      },
      hospitals: {
        status: "available",
        provider: "static-reference-contract",
      },
      persistence: {
        status: "available",
        provider: "browser-local-storage-and-broadcast-channel",
      },
    },
    checkedAt: new Date().toISOString(),
  };

  return Response.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
