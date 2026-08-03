"""Claude-on-Bedrock structured extraction adapter."""

from __future__ import annotations

import os
from typing import Protocol, runtime_checkable

from langchain_aws import ChatBedrockConverse
from langchain_core.messages import HumanMessage, SystemMessage

from .prompts import (
    COMPOSER_SYSTEM_PROMPT,
    EXTRACTION_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    composer_user_prompt,
    extraction_user_prompt,
    review_user_prompt,
)
from .schemas import (
    AgentRequest,
    ClinicalToolResult,
    CompositionPlan,
    ExtractionChange,
    ExtractionDraft,
    ExtractionUnknown,
    ModelSettings,
    ReviewDecision,
    ReviewDraft,
)

DEFAULT_REGION = "us-west-2"
DEFAULT_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
REQUIRED_TEMPERATURE = 0.3


@runtime_checkable
class Extractor(Protocol):
    def extract(self, request: AgentRequest) -> ExtractionDraft:
        """Return unconfirmed extraction candidates."""


@runtime_checkable
class Reviewer(Protocol):
    def review(
        self,
        request: AgentRequest,
        draft: ExtractionDraft,
        tool_results: list[ClinicalToolResult],
    ) -> ReviewDraft:
        """Return uncertainty-only decisions for existing candidate indexes."""


@runtime_checkable
class Composer(Protocol):
    def compose(
        self,
        changes: list[ExtractionChange],
        unknowns: list[ExtractionUnknown],
    ) -> CompositionPlan:
        """Return a safe handoff ordering plan for already verified items."""


def get_model_settings() -> ModelSettings:
    """Read deployment settings while enforcing the approved temperature."""

    requested_temperature = float(os.getenv("BEDROCK_TEMPERATURE", str(REQUIRED_TEMPERATURE)))
    if requested_temperature != REQUIRED_TEMPERATURE:
        raise ValueError("BEDROCK_TEMPERATURE must remain 0.3 for this workflow")
    return ModelSettings(
        region=os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", DEFAULT_REGION)),
        modelId=os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID),
        temperature=REQUIRED_TEMPERATURE,
        maxTokens=int(os.getenv("BEDROCK_MAX_TOKENS", "1800")),
    )


class ClaudeBedrockExtractor:
    """Lazy adapter so imports and deterministic tests never contact AWS."""

    def __init__(self, settings: ModelSettings | None = None) -> None:
        self.settings = settings or get_model_settings()
        self._structured_model = None

    def _model(self):
        if self._structured_model is None:
            model = ChatBedrockConverse(
                model_id=self.settings.modelId,
                region_name=self.settings.region,
                temperature=self.settings.temperature,
                max_tokens=self.settings.maxTokens,
            )
            self._structured_model = model.with_structured_output(ExtractionDraft)
        return self._structured_model

    def extract(self, request: AgentRequest) -> ExtractionDraft:
        result = self._model().invoke(
            [
                SystemMessage(content=EXTRACTION_SYSTEM_PROMPT),
                HumanMessage(content=extraction_user_prompt(request)),
            ]
        )
        return ExtractionDraft.model_validate(result)


class _ClaudeStructuredAgent:
    """Shared lazy Claude adapter with one fixed model configuration per role."""

    output_schema: type

    def __init__(self, settings: ModelSettings | None = None) -> None:
        self.settings = settings or get_model_settings()
        self._structured_model = None

    def _model(self):
        if self._structured_model is None:
            model = ChatBedrockConverse(
                model_id=self.settings.modelId,
                region_name=self.settings.region,
                temperature=self.settings.temperature,
                max_tokens=self.settings.maxTokens,
            )
            self._structured_model = model.with_structured_output(self.output_schema)
        return self._structured_model


class ClaudeBedrockReviewer(_ClaudeStructuredAgent):
    """Independent evidence and uncertainty reviewer."""

    output_schema = ReviewDraft

    def review(
        self,
        request: AgentRequest,
        draft: ExtractionDraft,
        tool_results: list[ClinicalToolResult],
    ) -> ReviewDraft:
        result = self._model().invoke(
            [
                SystemMessage(content=REVIEW_SYSTEM_PROMPT),
                HumanMessage(content=review_user_prompt(request, draft, tool_results)),
            ]
        )
        return ReviewDraft.model_validate(result)


class ClaudeBedrockComposer(_ClaudeStructuredAgent):
    """Ordering-only handoff/proposal composer."""

    output_schema = CompositionPlan

    def compose(
        self,
        changes: list[ExtractionChange],
        unknowns: list[ExtractionUnknown],
    ) -> CompositionPlan:
        result = self._model().invoke(
            [
                SystemMessage(content=COMPOSER_SYSTEM_PROMPT),
                HumanMessage(content=composer_user_prompt(changes, unknowns)),
            ]
        )
        return CompositionPlan.model_validate(result)


class DeterministicReviewer:
    """Test/failure adapter that only raises review strictness from tool metadata."""

    def review(
        self,
        _request: AgentRequest,
        draft: ExtractionDraft,
        tool_results: list[ClinicalToolResult],
    ) -> ReviewDraft:
        results_by_index: dict[int, list[ClinicalToolResult]] = {}
        for result in tool_results:
            results_by_index.setdefault(result.candidateIndex, []).append(result)

        decisions: list[ReviewDecision] = []
        for index, candidate in enumerate(draft.changes):
            uncertain = candidate.certainty == "needs_confirmation" or any(
                not result.ok for result in results_by_index.get(index, [])
            )
            decisions.append(
                ReviewDecision(
                    candidateIndex=index,
                    disposition="needs_confirmation" if uncertain else "retain",
                    reasonCode="UNIT_UNCERTAIN" if uncertain else "CLEAR_SUPPORT",
                )
            )
        return ReviewDraft(decisions=decisions)


class DeterministicComposer:
    """Stable ordering adapter used in tests and when the composer model fails."""

    def compose(
        self,
        changes: list[ExtractionChange],
        unknowns: list[ExtractionUnknown],
    ) -> CompositionPlan:
        return CompositionPlan(
            orderedChangeIndexes=list(range(len(changes))),
            orderedUnknownIndexes=list(range(len(unknowns))),
        )
