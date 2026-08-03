from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from ems_relay_agentcore.schemas import ALLOWED_FACT_PATHS, AgentRequest, FactPath


def backend_fact_paths() -> tuple[str, ...]:
    backend_types = Path(__file__).parents[2] / "backend" / "src" / "types.ts"
    source = backend_types.read_text(encoding="utf-8")
    match = re.search(
        r"export const ALLOWED_FACT_PATHS = \[(?P<body>.*?)\] as const;",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, "backend ALLOWED_FACT_PATHS declaration was not found"
    return tuple(re.findall(r'"([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)"', match.group("body")))


def test_agentcore_fact_paths_match_backend_contract() -> None:
    canonical = backend_fact_paths()
    assert canonical
    assert tuple(get_args(FactPath)) == canonical
    assert canonical == ALLOWED_FACT_PATHS


def test_agent_request_accepts_confirmed_reassessment_facts() -> None:
    facts = {
        path: {"value": 1, "sourceText": "재평가 확인"}
        for path in backend_fact_paths()
        if path.startswith("reassessment.")
    }
    request = AgentRequest.model_validate(
        {
            "caseId": "GW-CARDIO-050",
            "transcript": "재평가 결과를 확인합니다.",
            "confirmedState": {"caseId": "GW-CARDIO-050", "version": 8, "facts": facts},
            "context": {"source": "ptt", "requestedBy": "contract-test", "locale": "ko-KR"},
        }
    )
    assert set(request.confirmedState.facts) == set(facts)
