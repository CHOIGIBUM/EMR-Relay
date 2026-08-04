"""Role-separated LangGraph workflow for non-authoritative EMS proposals."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from .fallback import deterministic_fallback
from .invariants import enforce_proposal_only
from .model import (
    ClaudeBedrockExtractor,
    Composer,
    DeterministicComposer,
    DeterministicReviewer,
    Extractor,
    Reviewer,
)
from .safety import verify_draft
from .schemas import (
    AgentRequest,
    AgentResponse,
    AgentTraceItem,
    ClinicalToolResult,
    CompositionPlan,
    EvidenceItem,
    ExtractionChange,
    ExtractionDraft,
    ExtractionUnknown,
    ProcessingTrace,
    Proposal,
    ProposalChange,
    ReviewDraft,
    ToolTraceItem,
    UnknownItem,
    WarningItem,
    validate_json_payload,
)
from .tools import CLINICAL_TOOLS


class WorkflowState(TypedDict, total=False):
    request: AgentRequest
    draft: ExtractionDraft
    messages: Annotated[list[BaseMessage], add_messages]
    toolCallMetadata: dict[str, dict[str, object]]
    toolResults: list[ClinicalToolResult]
    reviewDraft: ReviewDraft
    verifiedChanges: list[ExtractionChange]
    verifiedUnknowns: list[ExtractionUnknown]
    warnings: list[WarningItem]
    agentTrace: list[AgentTraceItem]
    toolTrace: list[ToolTraceItem]
    compositionPlan: CompositionPlan
    response: AgentResponse


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def _digest(prefix: str, *parts: object, length: int) -> str:
    return f"{prefix}-{hashlib.sha256(_canonical(parts).encode('utf-8')).hexdigest()[:length]}"


def _fingerprint(agent: str, request: AgentRequest, *parts: object) -> str:
    payload = (
        agent,
        request.caseId,
        request.confirmedState.version,
        request.context.eventId,
        request.context.updateId,
        hashlib.sha256(request.transcript.encode("utf-8")).hexdigest(),
        parts,
    )
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _agent_trace(
    *,
    agent: str,
    status: str,
    request: AgentRequest,
    output_count: int,
    result_code: str,
    fingerprint_parts: tuple[object, ...] = (),
) -> AgentTraceItem:
    return AgentTraceItem.model_validate(
        {
            "agent": agent,
            "status": status,
            "inputFingerprint": _fingerprint(agent, request, *fingerprint_parts),
            "outputCount": output_count,
            "resultCode": result_code,
        }
    )


def _runtime_warning() -> WarningItem:
    return WarningItem(
        code="MODEL_FALLBACK",
        severity="warning",
        message="AI 추출을 사용할 수 없어 제한된 규칙으로만 정리했습니다. 모든 항목을 확인하세요.",
    )


def _reviewer_warning() -> WarningItem:
    return WarningItem(
        code="REVIEWER_FALLBACK",
        severity="warning",
        message="AI 교차 검토를 사용할 수 없어 결정론적 안전 검사를 적용했습니다.",
    )


def _composer_warning() -> WarningItem:
    return WarningItem(
        code="COMPOSER_FALLBACK",
        severity="info",
        message="전달 순서 구성에 기본 순서를 적용했습니다.",
    )


def _extraction_node(extractor: Extractor):
    def korean_ems_fact_extractor(state: WorkflowState) -> dict[str, object]:
        request = state["request"]
        try:
            # Validate even injected/test adapters. Extra authority-bearing keys fail closed.
            draft = ExtractionDraft.model_validate(extractor.extract(request))
            status = "completed"
            result_code = "EXTRACTION_COMPLETED"
            warnings: list[WarningItem] = []
        except Exception:
            draft = deterministic_fallback(request.transcript)
            status = "fallback"
            result_code = "EXTRACTION_FALLBACK"
            warnings = [_runtime_warning()]
        return {
            "draft": draft,
            "warnings": warnings,
            "agentTrace": [
                _agent_trace(
                    agent="korean_ems_fact_extractor",
                    status=status,
                    request=request,
                    output_count=len(draft.changes) + len(draft.unknowns),
                    result_code=result_code,
                    fingerprint_parts=(len(draft.changes), len(draft.unknowns)),
                )
            ],
        }

    korean_ems_fact_extractor.__name__ = "korean_ems_fact_extractor"
    return korean_ems_fact_extractor


def clinical_tool_dispatch(state: WorkflowState) -> dict[str, object]:
    request = state["request"]
    tool_calls: list[dict[str, object]] = []
    metadata: dict[str, dict[str, object]] = {}
    for candidate_index, _candidate in enumerate(state["draft"].changes):
        for tool_instance in CLINICAL_TOOLS:
            tool_name = tool_instance.name
            call_id = _digest(
                "tool",
                request.caseId,
                request.confirmedState.version,
                request.context.eventId,
                request.context.updateId,
                candidate_index,
                tool_name,
                length=20,
            )
            # Only an array index enters the visible tool-call arguments. The injected graph
            # state carries clinical content in memory and is never copied into our trace.
            tool_calls.append(
                {
                    "name": tool_name,
                    "args": {"candidateIndex": candidate_index},
                    "id": call_id,
                    "type": "tool_call",
                }
            )
            metadata[call_id] = {"candidateIndex": candidate_index, "toolName": tool_name}
    return {
        "messages": [AIMessage(content="", tool_calls=tool_calls)],
        "toolCallMetadata": metadata,
    }


def _message_payload(message: ToolMessage) -> object:
    content = message.content
    if isinstance(content, str):
        return json.loads(content)
    if isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict):
        item = content[0]
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            return json.loads(item["text"])
    return content


def _parse_tool_messages(state: WorkflowState) -> tuple[list[ClinicalToolResult], list[ToolTraceItem]]:
    results: list[ClinicalToolResult] = []
    traces: list[ToolTraceItem] = []
    metadata = state.get("toolCallMetadata", {})
    for message in state.get("messages", []):
        if not isinstance(message, ToolMessage):
            continue
        call_id = message.tool_call_id
        call_metadata = metadata.get(call_id, {})
        candidate_index = int(call_metadata.get("candidateIndex", 0))
        tool_name = str(call_metadata.get("toolName", message.name or "map_evidence_span"))
        try:
            result = ClinicalToolResult.model_validate(_message_payload(message))
            results.append(result)
            if result.ok and result.resultCode not in {"EVIDENCE_MULTIPLE_MATCHES"}:
                status = "ok"
            elif result.resultCode == "EVIDENCE_NOT_FOUND":
                status = "error"
            else:
                status = "warning"
            result_code = result.resultCode
        except Exception:
            status = "error"
            result_code = "TOOL_RESULT_INVALID"
        traces.append(
            ToolTraceItem.model_validate(
                {
                    "toolCallId": call_id,
                    "toolName": tool_name,
                    "candidateIndex": candidate_index,
                    "status": status,
                    "resultCode": result_code,
                }
            )
        )
    return results, traces


def _tool_result_map(results: list[ClinicalToolResult]) -> dict[tuple[int, str], ClinicalToolResult]:
    return {(item.candidateIndex, item.toolName): item for item in results}


def _tool_warnings(results: list[ClinicalToolResult]) -> list[WarningItem]:
    warnings: list[WarningItem] = []
    for result in results:
        if result.resultCode in {"UNIT_MISSING", "UNIT_UNRECOGNIZED"}:
            warnings.append(
                WarningItem(
                    code=result.resultCode,
                    severity="warning",
                    message="측정 단위를 확인할 수 없어 구급대원 확인이 필요합니다.",
                )
            )
        elif result.resultCode in {"RANGE_OUTSIDE_REFERENCE", "RANGE_VALUE_NOT_NUMERIC"}:
            warnings.append(
                WarningItem(
                    code=result.resultCode,
                    severity="warning",
                    message="값이 기술적 참고 범위를 벗어나 원문과 장비 표시를 다시 확인해야 합니다.",
                )
            )
        elif result.resultCode == "EVIDENCE_MULTIPLE_MATCHES":
            warnings.append(
                WarningItem(
                    code="EVIDENCE_MULTIPLE_MATCHES",
                    severity="info",
                    message="같은 표현이 원문에 여러 번 있어 첫 번째 위치를 근거로 연결했습니다.",
                )
            )
    return warnings


def _review_node(reviewer: Reviewer):
    def evidence_safety_reviewer(state: WorkflowState) -> dict[str, object]:
        request = state["request"]
        tool_results, tool_trace = _parse_tool_messages(state)
        result_map = _tool_result_map(tool_results)

        normalized_changes: list[ExtractionChange] = []
        for index, candidate in enumerate(state["draft"].changes):
            unit_result = result_map.get((index, "normalize_clinical_unit"))
            if unit_result and unit_result.ok and unit_result.normalizedUnit is not None:
                candidate = candidate.model_copy(update={"unit": unit_result.normalizedUnit})
            normalized_changes.append(candidate)
        normalized_draft = state["draft"].model_copy(update={"changes": normalized_changes})

        try:
            review_draft = ReviewDraft.model_validate(
                reviewer.review(request, normalized_draft, tool_results)
            )
            status = "completed"
            result_code = "REVIEW_COMPLETED"
            reviewer_warnings: list[WarningItem] = []
        except Exception:
            review_draft = DeterministicReviewer().review(request, normalized_draft, tool_results)
            status = "fallback"
            result_code = "REVIEW_FALLBACK"
            reviewer_warnings = [_reviewer_warning()]

        decision_by_index = {
            decision.candidateIndex: decision
            for decision in review_draft.decisions
            if decision.candidateIndex < len(normalized_changes)
        }
        reviewed_changes: list[ExtractionChange] = []
        for index, candidate in enumerate(normalized_changes):
            decision = decision_by_index.get(index)
            tool_uncertain = any(
                not result.ok
                for result in tool_results
                if result.candidateIndex == index
            )
            if decision is None or decision.disposition == "needs_confirmation" or tool_uncertain:
                candidate = candidate.model_copy(update={"certainty": "needs_confirmation"})
            reviewed_changes.append(candidate)

        verified, unknowns, safety_warnings = verify_draft(
            request,
            normalized_draft.model_copy(update={"changes": reviewed_changes}),
        )
        warnings = [
            *state.get("warnings", []),
            *_tool_warnings(tool_results),
            *reviewer_warnings,
            *safety_warnings,
        ]
        trace = _agent_trace(
            agent="evidence_safety_reviewer",
            status=status,
            request=request,
            output_count=len(verified) + len(unknowns),
            result_code=result_code,
            fingerprint_parts=(len(normalized_changes), len(tool_results), len(warnings)),
        )
        return {
            "toolResults": tool_results,
            "reviewDraft": review_draft,
            "verifiedChanges": verified,
            "verifiedUnknowns": unknowns,
            "warnings": warnings,
            "agentTrace": [*state.get("agentTrace", []), trace],
            "toolTrace": tool_trace,
        }

    evidence_safety_reviewer.__name__ = "evidence_safety_reviewer"
    return evidence_safety_reviewer


def _valid_permutation(indexes: list[int], size: int) -> bool:
    return len(indexes) == size and sorted(indexes) == list(range(size))


def _field_group(path: str) -> str:
    if path.startswith("patient.") or path.startswith("symptoms."):
        return "환자·증상"
    if path.startswith("consciousness.") or path.startswith("vitals."):
        return "의식·활력징후"
    if path.startswith("history."):
        return "과거력"
    if path.startswith("assessment."):
        return "현장 평가"
    if path.startswith("treatment."):
        return "응급처치"
    return "이송·재평가"


def _proposal_summary(changes: list[ExtractionChange], unknowns: list[ExtractionUnknown]) -> str:
    groups = list(dict.fromkeys(_field_group(item.path) for item in changes))
    group_text = f"({', '.join(groups)})" if groups else ""
    return (
        f"검토 대기 중인 환자정보 변경안 {len(changes)}건{group_text}과 미상 항목 "
        f"{len(unknowns)}건을 정리했습니다. 구급대원 확인 전에는 기록에 반영되지 않습니다."
    )


def _composer_node(composer: Composer):
    def handoff_proposal_composer(state: WorkflowState) -> dict[str, object]:
        request = state["request"]
        verified = state.get("verifiedChanges", [])
        verified_unknowns = state.get("verifiedUnknowns", [])
        warnings = list(state.get("warnings", []))

        try:
            plan = CompositionPlan.model_validate(composer.compose(verified, verified_unknowns))
            if not _valid_permutation(plan.orderedChangeIndexes, len(verified)) or not _valid_permutation(
                plan.orderedUnknownIndexes, len(verified_unknowns)
            ):
                raise ValueError("composer must return exact permutations")
            status = "completed"
            result_code = "COMPOSITION_COMPLETED"
        except Exception:
            plan = DeterministicComposer().compose(verified, verified_unknowns)
            status = "fallback"
            result_code = "COMPOSITION_FALLBACK"
            warnings.append(_composer_warning())

        ordered_changes = [verified[index] for index in plan.orderedChangeIndexes]
        ordered_unknowns = [verified_unknowns[index] for index in plan.orderedUnknownIndexes]
        proposal_id = _digest(
            "prop",
            request.caseId,
            request.confirmedState.version,
            request.context.eventId,
            request.context.updateId,
            request.transcript,
            length=24,
        )

        changes: list[ProposalChange] = []
        evidence: list[EvidenceItem] = []
        for index, candidate in enumerate(ordered_changes):
            change_id = _digest(
                "chg",
                proposal_id,
                index,
                candidate.path,
                candidate.value,
                candidate.unit,
                candidate.evidence,
                length=20,
            )
            evidence_id = _digest("ev", change_id, candidate.evidence, length=16)
            start = request.transcript.index(candidate.evidence)
            evidence.append(
                EvidenceItem(
                    evidenceId=evidence_id,
                    changeId=change_id,
                    field=candidate.path,
                    sourceText=candidate.evidence,
                    start=start,
                    end=start + len(candidate.evidence),
                )
            )
            changes.append(
                ProposalChange(
                    changeId=change_id,
                    path=candidate.path,
                    value=candidate.value,
                    unit=candidate.unit,
                    observedAt=candidate.observedAt,
                    certainty=candidate.certainty,
                    evidenceIds=[evidence_id],
                    note=candidate.note,
                )
            )

        unknowns = [
            UnknownItem(
                unknownId=_digest(
                    "unk",
                    proposal_id,
                    index,
                    item.field,
                    item.reason,
                    item.evidence,
                    length=16,
                ),
                field=item.field,
                reason=item.reason,
                sourceText=item.evidence,
            )
            for index, item in enumerate(ordered_unknowns)
        ]
        if not changes and not unknowns:
            warnings.append(
                WarningItem(
                    code="NO_RELIABLE_EXTRACTION",
                    severity="info",
                    message="원문에서 안전하게 정리할 수 있는 환자정보를 찾지 못했습니다.",
                )
            )

        composer_trace = _agent_trace(
            agent="handoff_proposal_composer",
            status=status,
            request=request,
            output_count=len(changes) + len(unknowns),
            result_code=result_code,
            fingerprint_parts=(len(changes), len(unknowns)),
        )
        response = AgentResponse(
            proposal=Proposal(
                proposalId=proposal_id,
                caseId=request.caseId,
                baseVersion=request.confirmedState.version,
                summary=_proposal_summary(ordered_changes, ordered_unknowns),
                changes=changes,
            ),
            evidence=evidence,
            unknowns=unknowns,
            warnings=warnings,
            trace=ProcessingTrace(
                agents=[*state.get("agentTrace", []), composer_trace],
                tools=state.get("toolTrace", []),
            ),
        )
        enforce_proposal_only(response, request.transcript)
        return {"compositionPlan": plan, "response": response}

    handoff_proposal_composer.__name__ = "handoff_proposal_composer"
    return handoff_proposal_composer


def build_graph(
    extractor: Extractor | None = None,
    reviewer: Reviewer | None = None,
    composer: Composer | None = None,
):
    """Compile one model extraction call plus deterministic safety and ordering roles.

    Callers can still inject a model-backed reviewer or composer for offline
    evaluation. They are intentionally not on the production critical path:
    the reviewer only raises uncertainty from deterministic tool results and
    the composer only returns a stable field order.
    """

    selected_extractor = extractor or ClaudeBedrockExtractor()
    selected_reviewer = reviewer or DeterministicReviewer()
    selected_composer = composer or DeterministicComposer()

    graph = StateGraph(WorkflowState)
    graph.add_node("korean_ems_fact_extractor", _extraction_node(selected_extractor))
    graph.add_node("clinical_tool_dispatch", clinical_tool_dispatch)
    graph.add_node("clinical_tools", ToolNode(CLINICAL_TOOLS))
    graph.add_node("evidence_safety_reviewer", _review_node(selected_reviewer))
    graph.add_node("handoff_proposal_composer", _composer_node(selected_composer))
    graph.add_edge(START, "korean_ems_fact_extractor")
    graph.add_edge("korean_ems_fact_extractor", "clinical_tool_dispatch")
    graph.add_edge("clinical_tool_dispatch", "clinical_tools")
    graph.add_edge("clinical_tools", "evidence_safety_reviewer")
    graph.add_edge("evidence_safety_reviewer", "handoff_proposal_composer")
    graph.add_edge("handoff_proposal_composer", END)
    return graph.compile()


@lru_cache(maxsize=1)
def _default_graph():
    return build_graph()


def invoke_workflow(
    payload: Any,
    extractor: Extractor | None = None,
    reviewer: Reviewer | None = None,
    composer: Composer | None = None,
) -> dict[str, object]:
    request = validate_json_payload(payload)
    graph = (
        build_graph(extractor, reviewer, composer)
        if any(adapter is not None for adapter in (extractor, reviewer, composer))
        else _default_graph()
    )
    result = graph.invoke({"request": request, "messages": []})
    response = AgentResponse.model_validate(result["response"])
    enforce_proposal_only(response, request.transcript)
    return response.model_dump(mode="json")
