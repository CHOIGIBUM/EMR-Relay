from __future__ import annotations

import main


def test_health_reports_healthy() -> None:
    # Keep this deliberately small: importing main also proves the AgentCore SDK wiring is valid.
    assert main.health().value == "Healthy"
