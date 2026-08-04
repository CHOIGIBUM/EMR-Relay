# EMS Relay AgentCore Runtime

This directory is the proposal-only AI boundary for EMS Relay. It accepts one reviewed speech update, extracts evidence-backed candidate facts, checks them deterministically, and returns a proposal for the existing backend's human review flow.

It does **not** confirm, save, diagnose, select a hospital, predict acceptance, or make a transport decision.

## Contract

Input keys are fixed:

- `caseId`: case identifier
- `transcript`: one Korean PTT/manual update
- `confirmedState`: read-only backend snapshot with `version` and confirmed `facts`
- `context`: capture source, requester, event/update IDs, phase, and optional timestamp

Output keys are fixed:

- `proposal`: always `PENDING_REVIEW`, `requiresHumanReview: true`, and `authoritative: false`
- `evidence`: exact transcript quotes and character offsets for each proposed change
- `unknowns`: explicitly spoken unknown or unassessed items
- `warnings`: model fallback, conflicts, missing evidence, and other review notices
- `trace`: PHI-minimised agent/tool execution metadata; no transcript, evidence quote, or clinical value

The workflow is intentionally role-separated and linear:

```text
korean_ems_fact_extractor
  -> clinical_tool_dispatch
  -> clinical_tools (LangGraph ToolNode)
  -> evidence_safety_reviewer
  -> handoff_proposal_composer
```

Only the extraction role calls Claude Haiku 4.5 through Amazon Bedrock with temperature `0.3` in
the default runtime. The extraction agent creates evidence-backed candidates. A LangGraph `ToolNode`
runs structured unit normalisation, broad technical range validation, and exact evidence-span mapping.
The reviewer deterministically retains a candidate or raises its uncertainty from those tool results,
and the composer deterministically orders already verified indexes. Optional model-backed reviewer and
composer adapters remain available for offline evaluation but are not on the production request path.
Deterministic code creates IDs, evidence links, and the final summary. The runtime has no confirmation
endpoint and no data-store client.

Tool calls expose only a candidate index. Clinical content is supplied as injected in-memory graph
state. The returned trace contains tool names, result codes, indexes, and SHA-256 input fingerprints,
but never raw transcript text, quotes, values, or tool arguments. Detailed ADOT/OTel content tracing is
disabled in the checked-in runtime configuration; application logs must not print invocation payloads.

If Bedrock fails or returns an invalid schema, a small deterministic fallback extracts only tightly formatted demographics, AVPU, blood pressure, pulse, respiratory rate, SpO2, temperature, and glucose. Every fallback value remains `needs_confirmation`.

## Local setup (Python 3.12)

PowerShell:

```powershell
cd agentcore
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
pytest
pytest --cov=ems_relay_agentcore --cov=main --cov-fail-under=85
ruff check .
```

Run the AgentCore-compatible HTTP server:

```powershell
python main.py
```

It exposes `POST /invocations` and `GET /ping` on the SDK's local port. An example request is available in [`examples/request.json`](examples/request.json).

## AWS deployment

See [`DEPLOY.md`](DEPLOY.md). Before deployment, confirm the runtime role can invoke the configured Bedrock model. The main backend should invoke this runtime with IAM, then store the returned proposal in its separate HITL review path. Only the backend's explicit human-confirm operation may update confirmed patient state.

## Security boundary

- AWS IAM authorizes runtime calls.
- Raw transcripts are processed in memory and are not written by this package.
- The prompt treats transcript, state, and context as untrusted data.
- Pydantic rejects extra input/model/output keys.
- Every change requires an exact transcript evidence span.
- Code-level invariants reject authoritative status or mutation-like output keys.
- `confirmedState` is never returned or mutated.
