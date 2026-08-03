"""Code-level guarantees that keep the runtime outside the confirmation path."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .schemas import AgentResponse

_FORBIDDEN_KEYS = {
    "accepted",
    "acceptance",
    "confirmation",
    "confirmed",
    "confirmedat",
    "confirmedby",
    "confirmedstate",
    "destination",
    "diagnosis",
    "hospitalselection",
    "persist",
    "rejected",
    "treatmentrecommendation",
    "triagescore",
    "write",
}


class ProposalAuthorityViolation(RuntimeError):
    """Raised if any response could be interpreted as an authoritative mutation."""


def _normalized_key(key: object) -> str:
    return "".join(character for character in str(key).lower() if character.isalnum())


def _walk_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, Mapping):
        for key, child in value.items():
            keys.add(_normalized_key(key))
            keys.update(_walk_keys(child))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for child in value:
            keys.update(_walk_keys(child))
    return keys


def enforce_proposal_only(response: AgentResponse, transcript: str) -> None:
    proposal = response.proposal
    if proposal.status != "PENDING_REVIEW":
        raise ProposalAuthorityViolation("proposal status must remain PENDING_REVIEW")
    if proposal.requiresHumanReview is not True or proposal.authoritative is not False:
        raise ProposalAuthorityViolation("proposal must require human review and be non-authoritative")

    forbidden = _walk_keys(response.model_dump(mode="json")) & _FORBIDDEN_KEYS
    if forbidden:
        raise ProposalAuthorityViolation(f"forbidden authoritative output keys: {sorted(forbidden)}")

    evidence_by_id = {item.evidenceId: item for item in response.evidence}
    for change in proposal.changes:
        if not change.evidenceIds:
            raise ProposalAuthorityViolation("every proposed change must cite evidence")
        for evidence_id in change.evidenceIds:
            evidence = evidence_by_id.get(evidence_id)
            if not evidence or evidence.changeId != change.changeId or evidence.field != change.path:
                raise ProposalAuthorityViolation("evidence reference does not match proposed change")
            if transcript[evidence.start : evidence.end] != evidence.sourceText:
                raise ProposalAuthorityViolation("evidence offsets must point to an exact transcript quote")

