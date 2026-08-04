"""Deterministic safety verification between model extraction and composition."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from .schemas import (
    AgentRequest,
    ExtractionChange,
    ExtractionDraft,
    ExtractionUnknown,
    WarningItem,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def verify_draft(
    request: AgentRequest,
    draft: ExtractionDraft,
) -> tuple[list[ExtractionChange], list[ExtractionUnknown], list[WarningItem]]:
    warnings: list[WarningItem] = []
    candidates_by_path: dict[str, list[ExtractionChange]] = defaultdict(list)

    for candidate in draft.changes:
        if candidate.evidence not in request.transcript:
            warnings.append(
                WarningItem(
                    code="EVIDENCE_NOT_FOUND",
                    severity="error",
                    field=candidate.path,
                    message="원문에서 그대로 확인할 수 없는 근거가 있어 변경안에서 제외했습니다.",
                )
            )
            continue
        if candidate.value is None:
            warnings.append(
                WarningItem(
                    code="NULL_VALUE_REMOVED",
                    severity="warning",
                    field=candidate.path,
                    message="값이 없는 항목은 환자정보 변경안으로 만들지 않았습니다.",
                )
            )
            continue
        candidates_by_path[candidate.path].append(candidate)

    verified: list[ExtractionChange] = []
    for path, path_candidates in candidates_by_path.items():
        distinct = {
            (_canonical(item.value), item.unit or "", item.observedAt.isoformat() if item.observedAt else "")
            for item in path_candidates
        }
        if len(distinct) > 1:
            warnings.append(
                WarningItem(
                    code="MULTIPLE_VALUES",
                    severity="warning",
                    field=path,
                    message="같은 항목에 서로 다른 값이 있어 자동 변경안을 만들지 않았습니다.",
                )
            )
            continue

        candidate = path_candidates[-1]
        confirmed = request.confirmedState.facts.get(path)  # type: ignore[arg-type]
        if confirmed and _canonical(confirmed.value) == _canonical(candidate.value) and (
            confirmed.unit or ""
        ) == (candidate.unit or ""):
            warnings.append(
                WarningItem(
                    code="UNCHANGED_VALUE",
                    severity="info",
                    field=path,
                    message="이미 확인된 값과 같아 중복 변경안을 만들지 않았습니다.",
                )
            )
            continue

        if confirmed and _canonical(confirmed.value) != _canonical(candidate.value):
            candidate = candidate.model_copy(update={"certainty": "needs_confirmation"})
            warnings.append(
                WarningItem(
                    code="CONFLICT_WITH_CONFIRMED",
                    severity="warning",
                    field=path,
                    message="기존 확인값과 다른 값입니다. 원문과 측정 시각을 다시 확인하세요.",
                )
            )
        verified.append(candidate)

    verified_unknowns: list[ExtractionUnknown] = []
    unsupported_unknown_count = 0
    for unknown in draft.unknowns:
        if not unknown.evidence or unknown.evidence not in request.transcript:
            unsupported_unknown_count += 1
            continue
        verified_unknowns.append(unknown)

    # Model-generated placeholders for absent fields are safely discarded. They
    # are one extraction-quality signal, not many user input errors.
    if unsupported_unknown_count:
        warnings.append(
            WarningItem(
                code="UNSUPPORTED_UNKNOWNS_IGNORED",
                severity="info",
                message=(
                    f"원문 근거가 없는 미상 항목 {unsupported_unknown_count}건을 "
                    "전달 목록에서 제외했습니다."
                ),
            )
        )

    return verified, verified_unknowns, warnings
