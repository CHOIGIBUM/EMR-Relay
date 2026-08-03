"""Deterministic, PHI-minimised tools used by the LangGraph reviewer stage."""

from __future__ import annotations

from typing import Annotated, Any

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from .schemas import AgentRequest, ClinicalToolResult, ExtractionDraft

_CANONICAL_UNITS: dict[str, tuple[str, set[str]]] = {
    "patient.age": ("years", {"years", "year", "yr", "yrs", "세"}),
    "vitals.systolicBp": ("mmHg", {"mmhg", "mm hg", "밀리미터수은주"}),
    "vitals.diastolicBp": ("mmHg", {"mmhg", "mm hg", "밀리미터수은주"}),
    "vitals.pulse": ("/min", {"/min", "bpm", "회/분", "회/min"}),
    "vitals.respiratoryRate": ("/min", {"/min", "rpm", "breaths/min", "회/분", "회/min"}),
    "vitals.spo2": ("%", {"%", "percent", "퍼센트"}),
    "vitals.temperature": ("°C", {"°c", "℃", "c", "celsius", "섭씨"}),
    "vitals.glucose": ("mg/dL", {"mg/dl", "mg dl", "밀리그램/데시리터"}),
}

_REFERENCE_RANGES: dict[str, tuple[float, float]] = {
    "patient.age": (0, 125),
    "symptoms.chestPainNrs": (0, 10),
    "vitals.systolicBp": (30, 300),
    "vitals.diastolicBp": (20, 200),
    "vitals.pulse": (20, 250),
    "vitals.respiratoryRate": (4, 80),
    "vitals.spo2": (50, 100),
    "vitals.temperature": (25, 45),
    "vitals.glucose": (10, 1_000),
}


def _candidate(state: dict[str, Any], index: int):
    draft = ExtractionDraft.model_validate(state["draft"])
    if index >= len(draft.changes):
        raise ValueError("candidate index is outside the extraction draft")
    return draft.changes[index]


def _unit_key(value: str) -> str:
    return " ".join(value.strip().lower().split())


@tool("normalize_clinical_unit")
def normalize_clinical_unit(
    candidateIndex: int,
    state: Annotated[dict[str, Any], InjectedState],
) -> dict[str, object]:
    """Return a canonical unit label without exposing the candidate value in the tool result."""

    candidate = _candidate(state, candidateIndex)
    specification = _CANONICAL_UNITS.get(candidate.path)
    if specification is None:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="normalize_clinical_unit",
            ok=True,
            resultCode="UNIT_NOT_APPLICABLE",
            normalizedUnit=candidate.unit,
        )
    elif candidate.unit is None:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="normalize_clinical_unit",
            ok=False,
            resultCode="UNIT_MISSING",
        )
    else:
        canonical, aliases = specification
        if _unit_key(candidate.unit) not in {_unit_key(item) for item in aliases}:
            result = ClinicalToolResult(
                candidateIndex=candidateIndex,
                toolName="normalize_clinical_unit",
                ok=False,
                resultCode="UNIT_UNRECOGNIZED",
            )
        else:
            result = ClinicalToolResult(
                candidateIndex=candidateIndex,
                toolName="normalize_clinical_unit",
                ok=True,
                resultCode="UNIT_CANONICAL" if candidate.unit == canonical else "UNIT_NORMALIZED",
                normalizedUnit=canonical,
            )
    return result.model_dump(mode="json")


@tool("validate_clinical_range")
def validate_clinical_range(
    candidateIndex: int,
    state: Annotated[dict[str, Any], InjectedState],
) -> dict[str, object]:
    """Check only broad technical bounds; this tool never judges clinical severity."""

    candidate = _candidate(state, candidateIndex)
    reference = _REFERENCE_RANGES.get(candidate.path)
    if reference is None:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="validate_clinical_range",
            ok=True,
            resultCode="RANGE_NOT_APPLICABLE",
        )
    elif not isinstance(candidate.value, (int, float)) or isinstance(candidate.value, bool):
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="validate_clinical_range",
            ok=False,
            resultCode="RANGE_VALUE_NOT_NUMERIC",
        )
    elif reference[0] <= float(candidate.value) <= reference[1]:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="validate_clinical_range",
            ok=True,
            resultCode="RANGE_WITHIN_REFERENCE",
        )
    else:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="validate_clinical_range",
            ok=False,
            resultCode="RANGE_OUTSIDE_REFERENCE",
        )
    return result.model_dump(mode="json")


@tool("map_evidence_span")
def map_evidence_span(
    candidateIndex: int,
    state: Annotated[dict[str, Any], InjectedState],
) -> dict[str, object]:
    """Map an exact evidence span while keeping transcript and quote out of tool arguments/results."""

    candidate = _candidate(state, candidateIndex)
    request = AgentRequest.model_validate(state["request"])
    occurrences: list[int] = []
    cursor = 0
    while True:
        position = request.transcript.find(candidate.evidence, cursor)
        if position < 0:
            break
        occurrences.append(position)
        cursor = position + max(1, len(candidate.evidence))

    if not occurrences:
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="map_evidence_span",
            ok=False,
            resultCode="EVIDENCE_NOT_FOUND",
        )
    else:
        start = occurrences[0]
        result = ClinicalToolResult(
            candidateIndex=candidateIndex,
            toolName="map_evidence_span",
            ok=True,
            resultCode="EVIDENCE_EXACT" if len(occurrences) == 1 else "EVIDENCE_MULTIPLE_MATCHES",
            evidenceStart=start,
            evidenceEnd=start + len(candidate.evidence),
        )
    return result.model_dump(mode="json")


CLINICAL_TOOLS = [normalize_clinical_unit, validate_clinical_range, map_evidence_span]
