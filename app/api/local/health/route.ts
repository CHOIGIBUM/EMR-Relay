import type { LocalHealthResponse } from "@/lib/localDemoTypes";

export async function GET(): Promise<Response> {
  const response: LocalHealthResponse = {
    status: "ok",
    mode: "local-mock",
    services: {
      agent: {
        status: "available",
        provider: "local-structured-voice-fixture",
      },
      hospitals: {
        status: "available",
        provider: "local-demo-fixture",
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
