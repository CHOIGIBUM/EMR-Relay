"""Validated request, intermediate, and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FactPath = Literal[
    "patient.age",
    "patient.sex",
    "symptoms.chiefComplaint",
    "symptoms.onsetAt",
    "symptoms.chestPain",
    "symptoms.associated",
    "consciousness.avpu",
    "vitals.systolicBp",
    "vitals.diastolicBp",
    "vitals.pulse",
    "vitals.respiratoryRate",
    "vitals.spo2",
    "vitals.temperature",
    "vitals.glucose",
    "history.conditions",
    "history.medications",
    "history.allergies",
    "assessment.ecg",
    "assessment.fieldImpression",
    "treatment.oxygen",
    "treatment.medications",
    "treatment.procedures",
    "transport.reassessment",
]

ALLOWED_FACT_PATHS: tuple[str, ...] = (
    "patient.age",
    "patient.sex",
    "symptoms.chiefComplaint",
    "symptoms.onsetAt",
    "symptoms.chestPain",
    "symptoms.associated",
    "consciousness.avpu",
    "vitals.systolicBp",
    "vitals.diastolicBp",
    "vitals.pulse",
    "vitals.respiratoryRate",
    "vitals.spo2",
    "vitals.temperature",
    "vitals.glucose",
    "history.conditions",
    "history.medications",
    "history.allergies",
    "assessment.ecg",
    "assessment.fieldImpression",
    "treatment.oxygen",
    "treatment.medications",
    "treatment.procedures",
    "transport.reassessment",
)

ProposalValue = str | int | float | bool | None | list[str]
MetadataValue = str | int | float | bool | None | list[str]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class ConfirmedFact(BaseModel):
    """Read-only view of a fact confirmed by a human in the main backend."""

    model_config = ConfigDict(extra="ignore")

    value: ProposalValue
    unit: str | None = None
    observedAt: datetime | None = None
    sourceText: str | None = None
    confirmedAt: datetime | None = None
    confirmedBy: str | None = None
    proposalId: str | None = None


class ConfirmedState(StrictModel):
    caseId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
    version: int = Field(ge=0)
    facts: dict[FactPath, ConfirmedFact] = Field(default_factory=dict)


class RequestContext(StrictModel):
    """Capture metadata. observedAt is not automatically treated as a measurement time."""

    source: Literal["ptt", "manual", "asr_test"] = "ptt"
    requestedBy: str = Field(min_length=1, max_length=128)
    locale: Literal["ko-KR"] = "ko-KR"
    eventId: str | None = Field(default=None, min_length=1, max_length=128)
    updateId: str | None = Field(default=None, min_length=1, max_length=128)
    phase: Literal["dispatch", "scene", "transport", "reassessment", "handoff"] | None = None
    observedAt: datetime | None = None
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)


class AgentRequest(StrictModel):
    caseId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
    transcript: str = Field(min_length=1, max_length=10_000)
    confirmedState: ConfirmedState
    context: RequestContext

    @model_validator(mode="after")
    def validate_case_binding(self) -> AgentRequest:
        if not self.transcript.strip():
            raise ValueError("transcript must contain spoken content")
        if self.confirmedState.caseId and self.confirmedState.caseId != self.caseId:
            raise ValueError("confirmedState.caseId must match caseId")
        return self


class ExtractionChange(StrictModel):
    path: FactPath
    value: ProposalValue
    unit: str | None = Field(default=None, max_length=32)
    observedAt: datetime | None = None
    certainty: Literal["clear", "needs_confirmation"]
    evidence: str = Field(min_length=1, max_length=500)
    note: str | None = Field(default=None, max_length=500)


class ExtractionUnknown(StrictModel):
    field: FactPath | None = None
    reason: str = Field(min_length=1, max_length=500)
    evidence: str | None = Field(default=None, max_length=500)


class ExtractionDraft(StrictModel):
    """The only shape accepted from the foundation model."""

    changes: list[ExtractionChange] = Field(default_factory=list, max_length=32)
    unknowns: list[ExtractionUnknown] = Field(default_factory=list, max_length=32)


class ClinicalToolResult(StrictModel):
    """PHI-minimised result emitted by one deterministic clinical tool."""

    candidateIndex: int = Field(ge=0, le=31)
    toolName: Literal[
        "normalize_clinical_unit",
        "validate_clinical_range",
        "map_evidence_span",
    ]
    ok: bool
    resultCode: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    normalizedUnit: str | None = Field(default=None, max_length=32)
    evidenceStart: int | None = Field(default=None, ge=0)
    evidenceEnd: int | None = Field(default=None, gt=0)


class ReviewDecision(StrictModel):
    """A reviewer may only retain a candidate or increase its review requirement."""

    candidateIndex: int = Field(ge=0, le=31)
    disposition: Literal["retain", "needs_confirmation"]
    reasonCode: Literal[
        "CLEAR_SUPPORT",
        "AMBIGUOUS_CONTEXT",
        "CORRECTED_STATEMENT",
        "CONFLICTING_STATEMENT",
        "UNIT_UNCERTAIN",
    ]


class ReviewDraft(StrictModel):
    decisions: list[ReviewDecision] = Field(default_factory=list, max_length=32)


class CompositionPlan(StrictModel):
    """The composer controls ordering only and cannot add or rewrite patient facts."""

    orderedChangeIndexes: list[int] = Field(default_factory=list, max_length=32)
    orderedUnknownIndexes: list[int] = Field(default_factory=list, max_length=32)


class WarningItem(StrictModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")
    severity: Literal["info", "warning", "error"]
    message: str = Field(min_length=1, max_length=500)
    field: FactPath | None = None


class EvidenceItem(StrictModel):
    evidenceId: str = Field(pattern=r"^ev-[a-f0-9]{16}$")
    changeId: str = Field(pattern=r"^chg-[a-f0-9]{20}$")
    field: FactPath
    sourceText: str = Field(min_length=1, max_length=500)
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_span(self) -> EvidenceItem:
        if self.end <= self.start:
            raise ValueError("evidence end must be greater than start")
        return self


class UnknownItem(StrictModel):
    unknownId: str = Field(pattern=r"^unk-[a-f0-9]{16}$")
    field: FactPath | None = None
    reason: str = Field(min_length=1, max_length=500)
    sourceText: str | None = Field(default=None, max_length=500)


class ProposalChange(StrictModel):
    changeId: str = Field(pattern=r"^chg-[a-f0-9]{20}$")
    path: FactPath
    value: ProposalValue
    unit: str | None = Field(default=None, max_length=32)
    observedAt: datetime | None = None
    certainty: Literal["clear", "needs_confirmation"]
    evidenceIds: Annotated[list[str], Field(min_length=1, max_length=4)]
    note: str | None = Field(default=None, max_length=500)


class Proposal(StrictModel):
    schemaVersion: Literal["1.0"] = "1.0"
    proposalId: str = Field(pattern=r"^prop-[a-f0-9]{24}$")
    caseId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
    baseVersion: int = Field(ge=0)
    status: Literal["PENDING_REVIEW"] = "PENDING_REVIEW"
    requiresHumanReview: Literal[True] = True
    authoritative: Literal[False] = False
    summary: str = Field(min_length=1, max_length=500)
    changes: list[ProposalChange] = Field(default_factory=list, max_length=32)


class AgentTraceItem(StrictModel):
    agent: Literal[
        "korean_ems_fact_extractor",
        "evidence_safety_reviewer",
        "handoff_proposal_composer",
    ]
    status: Literal["completed", "fallback"]
    inputFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    outputCount: int = Field(ge=0, le=64)
    resultCode: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")


class ToolTraceItem(StrictModel):
    """Safe execution metadata; raw arguments and clinical values are intentionally absent."""

    toolCallId: str = Field(pattern=r"^tool-[a-f0-9]{20}$")
    toolName: Literal[
        "normalize_clinical_unit",
        "validate_clinical_range",
        "map_evidence_span",
    ]
    candidateIndex: int = Field(ge=0, le=31)
    status: Literal["ok", "warning", "error"]
    resultCode: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,63}$")


class ProcessingTrace(StrictModel):
    schemaVersion: Literal["1.0"] = "1.0"
    phiContentLogged: Literal[False] = False
    agents: list[AgentTraceItem] = Field(min_length=3, max_length=3)
    tools: list[ToolTraceItem] = Field(default_factory=list, max_length=96)


class AgentResponse(StrictModel):
    """Successful runtime output with a PHI-minimised execution trace."""

    proposal: Proposal
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=64)
    unknowns: list[UnknownItem] = Field(default_factory=list, max_length=32)
    warnings: list[WarningItem] = Field(default_factory=list, max_length=64)
    trace: ProcessingTrace


class ModelSettings(StrictModel):
    region: str
    modelId: str
    temperature: Literal[0.3] = 0.3
    maxTokens: int = Field(ge=256, le=4096)


def validate_json_payload(value: Any) -> AgentRequest:
    """Single validation boundary used by both local tests and AgentCore Runtime."""

    return AgentRequest.model_validate(value)
