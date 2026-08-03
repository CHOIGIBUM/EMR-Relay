from __future__ import annotations

import main


def test_health_reports_healthy() -> None:
    # Keep this deliberately small: importing main also proves the AgentCore SDK wiring is valid.
    assert main.health().value == "Healthy"


def test_invalid_request_returns_phi_free_error_envelope() -> None:
    result = main.invoke({"caseId": "GW-CARDIO-050", "transcript": "민감한 원문"})
    assert result == {"error": {"code": "INVALID_AGENT_REQUEST", "issueCount": 2}}
    assert "민감한 원문" not in str(result)
