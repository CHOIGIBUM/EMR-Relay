# Deploy to Amazon Bedrock AgentCore Runtime

## Prerequisites

- AWS CLI authenticated to the intended AWS account and Region
- Python 3.12
- Node.js and the current AgentCore CLI: `npm install -g @aws/agentcore`
- Bedrock model access for the model in `BEDROCK_MODEL_ID`
- A runtime execution role permitted to call `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` for that model

The checked-in runtime configuration is [`agentcore/agentcore.json`](agentcore/agentcore.json). It uses IAM authorization and does not expose an unauthenticated endpoint.

## Configure target

Copy `agentcore/aws-targets.example.json` to `agentcore/aws-targets.json`, then replace the sample account ID and Region with the deployment account. Do not commit credentials or access keys.

## Validate and test locally

```powershell
agentcore validate
agentcore dev
```

Invoke the local development endpoint with `examples/request.json`, and verify that the result contains
`proposal`, `evidence`, `unknowns`, `warnings`, and the PHI-minimised `trace`. The proposal must remain
`PENDING_REVIEW`, and `trace.phiContentLogged` must remain `false`.

The checked-in runtime disables detailed ADOT/OTel instrumentation so model prompts, injected state,
tool state, and raw EMS transcripts are not copied into application traces. The response provides a
separate safe execution trace containing only role/tool names, result codes, indexes, counts, and hashes.

## Deploy

```powershell
agentcore deploy --dry-run
agentcore deploy
```

After deployment, grant the EMS Relay backend execution role permission to invoke only this AgentCore Runtime. Do not call the runtime directly from the browser or mobile client.

## Required backend integration

1. Backend reads the current confirmed snapshot and version.
2. Backend sends `caseId`, reviewed `transcript`, read-only `confirmedState`, and `context` to AgentCore.
3. AgentCore returns a proposal only.
4. Backend stores it as pending and broadcasts the review state.
5. A paramedic explicitly confirms selected changes through the backend HITL endpoint.
6. Backend performs optimistic version checking and writes the confirmed state.

Steps 4–6 are intentionally outside this runtime.
