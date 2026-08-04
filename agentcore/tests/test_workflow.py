from __future__ import annotations

import json
from typing import Any

import pytest
from langgraph.graph import END, START
from pydantic import ValidationError

import ems_relay_agentcore.workflow as workflow_module
from ems_relay_agentcore.fallback import deterministic_fallback
from ems_relay_agentcore.invariants import enforce_proposal_only
from ems_relay_agentcore.model import REQUIRED_TEMPERATURE, get_model_settings
from ems_relay_agentcore.prompts import extraction_user_prompt
from ems_relay_agentcore.schemas import (
    AgentRequest,
    AgentResponse,
    CompositionPlan,
    ExtractionDraft,
    Proposal,
    ReviewDraft,
)
from ems_relay_agentcore.workflow import build_graph, invoke_workflow


def request_payload(transcript: str = "혈압 178/96, 맥박 92, 산소포화도 97%입니다.") -> dict[str, Any]:
    return {
        "caseId": "EMS-GW-001",
        "transcript": transcript,
        "confirmedState": {
            "caseId": "EMS-GW-001",
            "version": 4,
            "facts": {},
        },
        "context": {
            "source": "ptt",
            "requestedBy": "paramedic-01",
            "locale": "ko-KR",
            "eventId": "event-01",
            "updateId": "update-01",
            "phase": "scene",
        },
    }


def test_deterministic_fallback_supports_only_the_structured_mobile_primary_survey() -> None:
    transcript = (
        "환자 접촉 후 초기 평가입니다. 기도 개방, 호흡 자발호흡, 순환 맥박 촉지입니다. "
        "의식수준은 AVPU A입니다. 주호소는 흉통입니다."
    )
    draft = deterministic_fallback(transcript)
    paths = {item.path for item in draft.changes}
    assert paths == {
        "assessment.airway",
        "assessment.breathing",
        "assessment.circulation",
        "consciousness.avpu",
        "symptoms.chiefComplaint",
    }
    assert deterministic_fallback("임의 문장").changes == []


class StaticExtractor:
    def __init__(self, result: Any) -> None:
        self.result = result

    def extract(self, _request: Any) -> Any:
        return self.result


class FailingExtractor:
    def extract(self, _request: Any) -> Any:
        raise RuntimeError("simulated Bedrock outage")


class StaticReviewer:
    def __init__(self, result: Any) -> None:
        self.result = result

    def review(self, _request: Any, _draft: Any, _tool_results: Any) -> Any:
        return self.result


class StaticComposer:
    def __init__(self, result: Any) -> None:
        self.result = result

    def compose(self, _changes: Any, _unknowns: Any) -> Any:
        return self.result


def test_required_graph_order_is_explicit() -> None:
    graph = build_graph(StaticExtractor(ExtractionDraft()))
    edges = {(edge.source, edge.target) for edge in graph.get_graph().edges}
    assert edges == {
        (START, "korean_ems_fact_extractor"),
        ("korean_ems_fact_extractor", "clinical_tool_dispatch"),
        ("clinical_tool_dispatch", "clinical_tools"),
        ("clinical_tools", "evidence_safety_reviewer"),
        ("evidence_safety_reviewer", "handoff_proposal_composer"),
        ("handoff_proposal_composer", END),
    }


def test_default_graph_calls_only_the_model_backed_extractor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    class CountingExtractor:
        def extract(self, _request: Any) -> ExtractionDraft:
            nonlocal calls
            calls += 1
            return ExtractionDraft.model_validate(
                {
                    "changes": [
                        {
                            "path": "vitals.pulse",
                            "value": 92,
                            "unit": "/min",
                            "certainty": "clear",
                            "evidence": "맥박 92",
                        }
                    ]
                }
            )

    monkeypatch.setattr(workflow_module, "ClaudeBedrockExtractor", CountingExtractor)
    graph = workflow_module.build_graph()
    result = graph.invoke(
        {
            "request": AgentRequest.model_validate(request_payload("맥박 92")),
            "messages": [],
        }
    )

    assert calls == 1
    assert result["response"].proposal.changes[0].path == "vitals.pulse"
    assert [item.agent for item in result["response"].trace.agents] == [
        "korean_ems_fact_extractor",
        "evidence_safety_reviewer",
        "handoff_proposal_composer",
    ]


def test_extraction_prompt_accepts_a_non_restrictive_field_focus_hint() -> None:
    payload = request_payload("통증은 7점이고 왼팔로 뻗칩니다.")
    payload["context"]["metadata"] = {
        "allowedFieldPaths": [
            "symptoms.chestPainNrs",
            "symptoms.chestPainRadiation",
            "not.allowed",
        ]
    }

    prompt = extraction_user_prompt(AgentRequest.model_validate(payload))

    assert (
        '<field_focus_hint>["symptoms.chestPainNrs","symptoms.chestPainRadiation"]'
        "</field_focus_hint>"
    ) in prompt
    assert "retain any other explicit supported fact" in prompt


def test_supported_extraction_returns_only_reviewable_proposal() -> None:
    draft = {
        "changes": [
            {
                "path": "vitals.systolicBp",
                "value": 178,
                "unit": "mmHg",
                "certainty": "clear",
                "evidence": "혈압 178/96",
            },
            {
                "path": "vitals.diastolicBp",
                "value": 96,
                "unit": "mmHg",
                "certainty": "clear",
                "evidence": "혈압 178/96",
            },
        ],
        "unknowns": [],
    }

    result = invoke_workflow(request_payload(), StaticExtractor(draft))

    assert set(result) == {"proposal", "evidence", "unknowns", "warnings", "trace"}
    assert result["proposal"]["status"] == "PENDING_REVIEW"
    assert result["proposal"]["requiresHumanReview"] is True
    assert result["proposal"]["authoritative"] is False
    assert len(result["proposal"]["changes"]) == 2
    for evidence in result["evidence"]:
        transcript = request_payload()["transcript"]
        assert transcript[evidence["start"] : evidence["end"]] == evidence["sourceText"]
    assert [item["agent"] for item in result["trace"]["agents"]] == [
        "korean_ems_fact_extractor",
        "evidence_safety_reviewer",
        "handoff_proposal_composer",
    ]
    assert len(result["trace"]["tools"]) == 6
    assert result["trace"]["phiContentLogged"] is False
    assert "혈압 178/96" not in json.dumps(result["trace"], ensure_ascii=False)


def test_model_failure_uses_minimal_deterministic_fallback() -> None:
    payload = request_payload("72세 남성, 혈압 178/96, 맥박 92, SpO2 97%, AVPU A")
    first = invoke_workflow(payload, FailingExtractor())
    second = invoke_workflow(payload, FailingExtractor())

    assert first == second
    assert any(warning["code"] == "MODEL_FALLBACK" for warning in first["warnings"])
    paths = {item["path"] for item in first["proposal"]["changes"]}
    assert paths == {
        "patient.age",
        "patient.sex",
        "vitals.systolicBp",
        "vitals.diastolicBp",
        "vitals.pulse",
        "vitals.spo2",
        "consciousness.avpu",
    }
    assert {item["certainty"] for item in first["proposal"]["changes"]} == {
        "needs_confirmation"
    }


def test_invalid_model_authority_keys_fail_closed_to_fallback() -> None:
    malicious = {
        "changes": [],
        "unknowns": [],
        "confirmedState": {"vitals.systolicBp": 178},
    }
    result = invoke_workflow(request_payload("현장 도착했습니다."), StaticExtractor(malicious))

    assert result["proposal"]["changes"] == []
    assert any(warning["code"] == "MODEL_FALLBACK" for warning in result["warnings"])
    assert "confirmedState" not in result


def test_non_verbatim_evidence_is_removed() -> None:
    draft = {
        "changes": [
            {
                "path": "vitals.pulse",
                "value": 92,
                "unit": "/min",
                "certainty": "clear",
                "evidence": "맥박은 92회입니다",
            }
        ],
        "unknowns": [],
    }
    result = invoke_workflow(request_payload(), StaticExtractor(draft))

    assert result["proposal"]["changes"] == []
    assert any(warning["code"] == "EVIDENCE_NOT_FOUND" for warning in result["warnings"])


def test_evidence_less_unknown_placeholders_are_coalesced_to_one_info_notice() -> None:
    draft = {
        "changes": [],
        "unknowns": [
            {
                "field": "history.medications",
                "reason": "입력에 없음",
                "evidence": None,
            }
            for _ in range(20)
        ],
    }

    result = invoke_workflow(request_payload("주호소는 흉통입니다."), StaticExtractor(draft))

    assert result["unknowns"] == []
    assert not any(item["code"] == "UNKNOWN_WITHOUT_EVIDENCE" for item in result["warnings"])
    notices = [item for item in result["warnings"] if item["code"] == "UNSUPPORTED_UNKNOWNS_IGNORED"]
    assert len(notices) == 1
    assert notices[0]["severity"] == "info"


def test_tools_normalize_units_and_mark_outside_reference_for_review() -> None:
    transcript = "산소포화도 42퍼센트"
    draft = {
        "changes": [
            {
                "path": "vitals.spo2",
                "value": 42,
                "unit": "퍼센트",
                "certainty": "clear",
                "evidence": transcript,
            }
        ],
        "unknowns": [],
    }

    result = invoke_workflow(request_payload(transcript), StaticExtractor(draft))

    change = result["proposal"]["changes"][0]
    assert change["unit"] == "%"
    assert change["certainty"] == "needs_confirmation"
    assert any(item["code"] == "RANGE_OUTSIDE_REFERENCE" for item in result["warnings"])
    assert {item["toolName"] for item in result["trace"]["tools"]} == {
        "normalize_clinical_unit",
        "validate_clinical_range",
        "map_evidence_span",
    }


def test_reviewer_can_only_increase_human_review_requirement() -> None:
    transcript = "맥박 92"
    draft = ExtractionDraft.model_validate(
        {
            "changes": [
                {
                    "path": "vitals.pulse",
                    "value": 92,
                    "unit": "/min",
                    "certainty": "clear",
                    "evidence": transcript,
                }
            ]
        }
    )
    reviewer = StaticReviewer(
        ReviewDraft.model_validate(
            {
                "decisions": [
                    {
                        "candidateIndex": 0,
                        "disposition": "needs_confirmation",
                        "reasonCode": "AMBIGUOUS_CONTEXT",
                    }
                ]
            }
        )
    )

    result = invoke_workflow(
        request_payload(transcript),
        StaticExtractor(draft),
        reviewer,
        StaticComposer(CompositionPlan(orderedChangeIndexes=[0], orderedUnknownIndexes=[])),
    )

    assert result["proposal"]["changes"][0]["certainty"] == "needs_confirmation"
    assert result["trace"]["agents"][1]["status"] == "completed"


def test_invalid_composer_plan_falls_back_without_changing_facts() -> None:
    transcript = "맥박 92"
    draft = {
        "changes": [
            {
                "path": "vitals.pulse",
                "value": 92,
                "unit": "/min",
                "certainty": "clear",
                "evidence": transcript,
            }
        ],
        "unknowns": [],
    }
    invalid_plan = CompositionPlan(orderedChangeIndexes=[], orderedUnknownIndexes=[])

    result = invoke_workflow(
        request_payload(transcript),
        StaticExtractor(draft),
        StaticReviewer(ReviewDraft()),
        StaticComposer(invalid_plan),
    )

    assert [item["path"] for item in result["proposal"]["changes"]] == ["vitals.pulse"]
    assert result["trace"]["agents"][2]["status"] == "fallback"
    assert any(item["code"] == "COMPOSER_FALLBACK" for item in result["warnings"])


def test_conflict_with_confirmed_state_cannot_overwrite() -> None:
    payload = request_payload("재측정 혈압 178/96입니다.")
    payload["confirmedState"]["facts"] = {
        "vitals.systolicBp": {"value": 160, "unit": "mmHg"}
    }
    draft = {
        "changes": [
            {
                "path": "vitals.systolicBp",
                "value": 178,
                "unit": "mmHg",
                "certainty": "clear",
                "evidence": "혈압 178/96",
            }
        ],
        "unknowns": [],
    }
    original = payload["confirmedState"].copy()

    result = invoke_workflow(payload, StaticExtractor(draft))

    assert result["proposal"]["changes"][0]["certainty"] == "needs_confirmation"
    assert any(warning["code"] == "CONFLICT_WITH_CONFIRMED" for warning in result["warnings"])
    assert payload["confirmedState"] == original
    assert result["proposal"]["baseVersion"] == 4


def test_empty_or_mismatched_input_is_rejected_before_graph() -> None:
    payload = request_payload()
    payload["transcript"] = "   "
    with pytest.raises(ValidationError):
        invoke_workflow(payload, StaticExtractor(ExtractionDraft()))

    payload = request_payload()
    payload["confirmedState"]["caseId"] = "EMS-GW-OTHER"
    with pytest.raises(ValidationError):
        invoke_workflow(payload, StaticExtractor(ExtractionDraft()))


def test_temperature_is_pinned_to_point_three(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BEDROCK_TEMPERATURE", raising=False)
    assert REQUIRED_TEMPERATURE == 0.3
    assert get_model_settings().temperature == 0.3

    monkeypatch.setenv("BEDROCK_TEMPERATURE", "0.2")
    with pytest.raises(ValueError, match="must remain 0.3"):
        get_model_settings()


def test_response_schema_cannot_be_confirmed() -> None:
    with pytest.raises(ValidationError):
        Proposal.model_validate(
            {
                "proposalId": "prop-0123456789abcdef01234567",
                "caseId": "EMS-GW-001",
                "baseVersion": 0,
                "status": "CONFIRMED",
                "summary": "invalid",
            }
        )


def test_authority_invariant_accepts_only_validated_response() -> None:
    result = invoke_workflow(request_payload(), StaticExtractor(ExtractionDraft()))
    response = AgentResponse.model_validate(result)
    enforce_proposal_only(response, request_payload()["transcript"])
