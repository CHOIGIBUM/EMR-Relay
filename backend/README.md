# EMS Relay AWS Backend

EMS Relay의 프론트엔드가 사용할 최소 서버리스 백엔드입니다. 음성 인식 결과를 Bedrock에 전달해 **검토 전 변경안**을 만들고, 구급대원의 HITL 확인이 끝난 필드만 DynamoDB의 확정 상태에 조건부 저장합니다.

## 구성

```text
API Gateway HTTP API
└─ Lambda (TypeScript / Node.js 22)
   ├─ POST /cases/{id}/voice-updates/proposals
   │  └─ Bedrock Converse → 구조화 변경안
   ├─ GET /hospitals
   │  └─ 병원 정적 참고정보 + 거리·ETA fixture
   ├─ GET /cases/{id}
   │  └─ 확정 상태 + 변경안 + 감사 이력
   ├─ POST /cases/{id}/confirm
   │  └─ HITL 결정 + DynamoDB 조건부 트랜잭션
   └─ GET /health

DynamoDB single table
├─ STATE#CONFIRMED
├─ PROPOSAL#{proposalId}
└─ AUDIT#{timestamp}#{auditId}
```

Agent는 확정 상태를 직접 변경하지 않습니다. `/cases/{id}/voice-updates/proposals`는 `PENDING` 변경안만 저장하고, `/confirm`이 모든 제안 필드에 대한 사람의 승인·제외 결정을 받은 뒤 상태 버전을 갱신합니다. 기존 `/agent`도 로컬 호환 경로로 유지합니다.

## 주요 설계 원칙

- Bedrock Converse의 강제 tool-use와 JSON Schema를 함께 사용합니다.
- 모델 온도는 `0.3`입니다.
- 허용된 환자정보 경로만 제안할 수 있습니다. 병원 추천 경로는 존재하지 않습니다.
- 미상과 부정 표현을 임의의 정상·없음 값으로 바꾸지 않습니다.
- 확정 상태는 `expectedVersion` 조건부 트랜잭션으로 갱신합니다.
- 제안 원문의 SHA-256만 저장하며 raw WAV는 저장하지 않습니다.
- 확정 필드에는 원문 근거, 관찰시각, 확인자, 확인시각, proposalId가 남습니다.
- 액세스 키나 API 키를 코드·환경변수 파일에 넣지 않습니다. Lambda 실행 역할과 개발자의 AWS 프로필을 사용합니다.

## 로컬 검사

Node.js 22 LTS가 필요합니다.

```powershell
cd backend
npm install
npm test
npm run typecheck
```

테스트는 AWS 호출 없이 다음을 확인합니다.

- 음성 변경안 입력 스키마
- Bedrock 구조화 출력 스키마
- 허용하지 않은 필드 차단
- HITL 결정 중복·누락 차단
- 승인된 필드만 확정 상태에 반영
- 확인자와 원문 근거 보존

SAM CLI가 설치되어 있으면 다음 검사도 실행할 수 있습니다.

```powershell
npm run sam:validate
npm run sam:build
```

## 배포

먼저 대상 리전에서 사용할 Anthropic Claude 모델 또는 inference profile에 대한 Bedrock model access를 확인합니다. 서울 리전 기본값은 `global.anthropic.claude-haiku-4-5-20251001-v1:0`이며 모델 ID는 비밀값이 아니므로 CloudFormation 파라미터로 전달합니다.

```powershell
.\scripts\deploy.ps1 `
  -StackName ems-relay-backend `
  -Region ap-northeast-2 `
  -Profile ems-relay-cgb `
  -ExpectedAccountId "462993243992" `
  -ModelId "global.anthropic.claude-haiku-4-5-20251001-v1:0" `
  -CorsOrigins "http://localhost:3000,https://your-private-site.example" `
  -ArtifactBucket "<비공개 SAM 배포 버킷>"
```

배포 스크립트는 대상 계정 ID를 먼저 검증한 뒤 `sam validate → sam build → sam deploy` 순서로 실행합니다. 최초 배포 후 CloudFormation 출력의 `ApiUrl`을 프론트엔드 `NEXT_PUBLIC_EMS_BACKEND_URL`에 설정합니다.

> `CorsOrigins`에는 로컬 개발 주소와 실제 프론트엔드 주소만 쉼표로 구분해 지정합니다. 와일드카드는 사용하지 않습니다.

## API

### `GET /health`

민감정보 없이 함수·Bedrock·테이블 설정 여부를 반환합니다.

### `POST /cases/GW-CARDIO-050/voice-updates/proposals`

```json
{
  "case_id": "GW-CARDIO-050",
  "update_id": "GW-CARDIO-050-U03",
  "transcript": "혈압 163에 90, 맥박 91회, 식은땀과 오심 있습니다.",
  "locale": "ko-KR",
  "client_event_id": "3d945b93-b3cf-48b5-b6f2-706ae7f879cc"
}
```

응답은 프론트엔드의 `VoiceProposalResponse` 계약과 동일합니다. `pending_review`는 항상 `true`이며 `proposed_updates[].source`, `fact_status`, `warnings`를 모바일 HITL 카드에 표시합니다. DynamoDB 내부 변경안 상태는 `PENDING`입니다.

현재 AWS 계정의 Bedrock 호출이 결제수단 또는 Anthropic 모델 사용 등록 문제로 거절되면 API는 각각 `503 BEDROCK_BILLING_NOT_READY` 또는 `503 BEDROCK_MODEL_ACCESS_NOT_READY`를 반환합니다. 프론트엔드에서 `NEXT_PUBLIC_EMS_ALLOW_LOCAL_FALLBACK=true`를 설정하면 이 경우 준비된 로컬 시연 응답으로 전환할 수 있습니다.

### `GET /hospitals?case_id=GW-CARDIO-050&lat=37.748&lng=127.849`

현재 MVP에서는 HIRA·NMC 실시간 수용정보가 아닌 시연 별칭 기관과 시연용 거리·ETA를 반환합니다. 실제 의료기관 이름을 fixture에 사용하지 않으며, 응답의 `source`는 `local_fixture`입니다. 시설 태그와 거리도 API 계약 확인용 값일 뿐 실제 수용 가능 상태로 해석하지 않습니다.

### `GET /cases/GW-CARDIO-050`

```json
{
  "caseId": "GW-CARDIO-050",
  "confirmedState": { "version": 0, "facts": {} },
  "proposals": [],
  "audit": []
}
```

### `POST /cases/GW-CARDIO-050/confirm`

모든 변경항목을 한 번씩 승인하거나 제외해야 합니다. 사용자가 값을 고쳤다면 `value`에 교정값을 넣습니다.

```json
{
  "proposalId": "<proposalId>",
  "expectedVersion": 0,
  "reviewedBy": "PARAMEDIC-01",
  "decisions": [
    { "changeId": "<changeId-1>", "action": "accept", "value": 165 },
    { "changeId": "<changeId-2>", "action": "reject" }
  ]
}
```

다른 사용자가 먼저 확정했다면 `409 VERSION_CONFLICT`를 반환합니다. 클라이언트는 사건을 다시 조회한 후 새 버전을 기준으로 검토해야 합니다.

## DynamoDB 항목

- `PK`: `CASE#{caseId}`
- 확정 상태 `SK`: `STATE#CONFIRMED`
- 변경안 `SK`: `PROPOSAL#{proposalId}`
- 감사 이력 `SK`: `AUDIT#{ISO timestamp}#{auditId}`

테이블은 On-Demand, AWS 관리형 서버 측 암호화, Point-in-Time Recovery, 삭제 방지 목적의 CloudFormation `Retain` 정책을 사용합니다.

## 운영 전 추가할 항목

- Cognito JWT Authorizer 및 역할별 사건 접근 통제
- CloudWatch 로그의 의료정보 마스킹 정책
- Bedrock Guardrails와 AgentCore Runtime 연결
- API Gateway WAF·사용량 제한
- DynamoDB 보존기간 및 파기 정책
- 전자서명·공식 구급활동일지 시스템 연계 검토

현재 구현은 해커톤용 HITL 백엔드이며, 공식 의료기록 자동 제출이나 임상 의사결정을 수행하지 않습니다.
