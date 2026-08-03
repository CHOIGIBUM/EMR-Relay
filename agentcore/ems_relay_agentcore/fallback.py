"""Conservative deterministic extraction used only when model extraction fails."""

from __future__ import annotations

import re
from collections.abc import Iterator

from .schemas import ExtractionChange, ExtractionDraft


def _change(path: str, value: str | int | float, unit: str | None, evidence: str) -> ExtractionChange:
    return ExtractionChange.model_validate(
        {
            "path": path,
            "value": value,
            "unit": unit,
            "certainty": "needs_confirmation",
            "evidence": evidence,
            "note": "모델 실패 후 제한된 규칙으로 추출됨",
        }
    )


def _numeric_matches(transcript: str) -> Iterator[ExtractionChange]:
    patterns: tuple[tuple[str, re.Pattern[str], str | None, type[int] | type[float]], ...] = (
        (
            "vitals.pulse",
            re.compile(r"(?:맥박|심박수|HR)\s*(?:은|는|이|가)?\s*(\d{2,3})", re.IGNORECASE),
            "/min",
            int,
        ),
        (
            "vitals.respiratoryRate",
            re.compile(r"(?:호흡수|RR)\s*(?:은|는|이|가)?\s*(\d{1,2})", re.IGNORECASE),
            "/min",
            int,
        ),
        (
            "vitals.spo2",
            re.compile(
                r"(?:산소\s*포화도|SpO2|SpO₂)\s*(?:은|는|이|가)?\s*(\d{2,3})\s*(?:%|퍼센트)?",
                re.IGNORECASE,
            ),
            "%",
            int,
        ),
        (
            "vitals.temperature",
            re.compile(r"(?:체온|BT)\s*(?:은|는|이|가)?\s*(\d{2}(?:\.\d+)?)", re.IGNORECASE),
            "°C",
            float,
        ),
        (
            "vitals.glucose",
            re.compile(r"(?:혈당|BST)\s*(?:은|는|이|가)?\s*(\d{2,3})", re.IGNORECASE),
            "mg/dL",
            int,
        ),
    )
    for path, pattern, unit, caster in patterns:
        for match in pattern.finditer(transcript):
            yield _change(path, caster(match.group(1)), unit, match.group(0))


def deterministic_fallback(transcript: str) -> ExtractionDraft:
    """Extract only tightly formatted demographics, AVPU, and vital signs.

    The fallback deliberately does not infer symptoms, diagnoses, treatments, or hospitals.
    The last explicit mention of a field wins, and every value remains needs_confirmation.
    """

    candidates: list[ExtractionChange] = []

    for match in re.finditer(
        r"(?P<age>\d{2,3})\s*세\s*(?P<sex>남성|남자|여성|여자)", transcript
    ):
        sex = "male" if match.group("sex") in {"남성", "남자"} else "female"
        candidates.extend(
            [
                _change("patient.age", int(match.group("age")), "years", match.group(0)),
                _change("patient.sex", sex, None, match.group(0)),
            ]
        )

    for match in re.finditer(
        r"(?:혈압|BP)\s*(?:은|는|이|가)?\s*(\d{2,3})\s*(?:/|에)\s*(\d{2,3})",
        transcript,
        re.IGNORECASE,
    ):
        candidates.extend(
            [
                _change("vitals.systolicBp", int(match.group(1)), "mmHg", match.group(0)),
                _change("vitals.diastolicBp", int(match.group(2)), "mmHg", match.group(0)),
            ]
        )

    candidates.extend(_numeric_matches(transcript))

    for match in re.finditer(r"AVPU\s*(?:는|은|이|가)?\s*([AVPU])\b", transcript, re.IGNORECASE):
        candidates.append(_change("consciousness.avpu", match.group(1).upper(), None, match.group(0)))

    latest_by_path: dict[str, ExtractionChange] = {}
    for candidate in candidates:
        latest_by_path[candidate.path] = candidate
    return ExtractionDraft(changes=list(latest_by_path.values()), unknowns=[])

