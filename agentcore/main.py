"""Amazon Bedrock AgentCore Runtime HTTP entrypoint."""

from __future__ import annotations

from typing import Any

from bedrock_agentcore.runtime import BedrockAgentCoreApp, PingStatus
from pydantic import ValidationError

from ems_relay_agentcore.workflow import invoke_workflow

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: dict[str, Any], _context: Any = None) -> dict[str, object]:
    """Return a non-authoritative proposal; this endpoint has no confirm operation."""

    try:
        return invoke_workflow(payload)
    except ValidationError as error:
        # AgentCore records uncaught exception text in managed runtime logs.
        # Pydantic diagnostics can include rejected input values, so return only
        # a bounded, PHI-free error envelope to the authenticated backend.
        return {"error": {"code": "INVALID_AGENT_REQUEST", "issueCount": error.error_count()}}


@app.ping
def health() -> PingStatus:
    """AgentCore exposes this as GET /ping."""

    return PingStatus.HEALTHY


if __name__ == "__main__":
    app.run()
