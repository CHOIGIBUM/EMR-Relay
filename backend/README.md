# EMS Relay Seoul v2 backend

서울 리전의 AWS SAM 기반 AppSync 백엔드입니다. 구급대원 사건 처리, 확정 환자정보, 병원 inbox, 점진적 병원 매칭, PTT 음성 변경안을 최소한의 서버리스 구성으로 제공합니다.

## 구성

```text
Cognito 사용자
  → AppSync GraphQL API
      ├─ AppSyncFunction → DynamoDB
      ├─ VoiceFunction → Transcribe Streaming / Bedrock
      └─ SQS MatchingQueue → MatchingFunction → NMC / HIRA / Kakao
```

- `template-v2.yaml`: 배포 기준 SAM 템플릿
- `schemas/v2.graphql`: GraphQL 계약
- `src/v2/appsyncHandler.ts`: 조회·업무 명령·매칭 시작 resolver
- `src/v2/voiceHandler.ts`: Transcribe 세션과 음성 변경안 resolver
- `src/v2/matchingHandler.ts`: SQS 기반 거리 범위별 병원 동시 요청
- `scripts/seed-v2.mjs`: 합성 사건 3건 생성 또는 정확한 대상만 재설정

실시간 통신은 AppSync Subscription으로 제공합니다.

## GraphQL 계약

### Query

| 필드 | 권한 | 역할 |
|---|---|---|
| `listMyCases` | paramedic | 자신에게 배정된 사건 목록 |
| `getCase(caseId)` | 사건 접근 권한 | 사건·확정정보·이벤트·병원요청 스냅샷 |
| `listHospitalInbox(hospitalId)` | hospital | 자신의 병원에 온 요청 목록 |

### Mutation

| 필드 | 역할 |
|---|---|
| `executeCommand` | 출동·환자 접촉·평가 저장·병원 회신·이송 상태 변경 |
| `requestHospitalMatching` | 15 km부터 시작하는 비동기 병원 매칭 작업 생성 |
| `createTranscribeSession` | 300초 유효 Transcribe Streaming 연결정보 생성 |
| `structureVoiceUpdate` | `PENDING` 음성 변경안 생성 |
| `publishCaseUpdate` | 매칭 Lambda의 IAM 전용 실시간 이벤트 발행 |

### Subscription

| 필드 | 권한 | 역할 |
|---|---|---|
| `onCaseUpdate(caseId)` | 해당 paramedic | 사건 변경 알림 |
| `onHospitalInbox(hospitalId)` | 해당 hospital | 병원 inbox 변경 알림 |

GraphQL의 `AWSJSON` 필드는 JSON 문자열로 전달됩니다. 스키마는 [schemas/v2.graphql](./schemas/v2.graphql)을 단일 계약으로 사용합니다.

## 업무 상태

```text
ASSIGNED
→ DISPATCHING
→ ON_SCENE
→ PATIENT_CONTACT
→ ASSESSING
→ HOSPITAL_REQUESTED
→ DESTINATION_CONFIRMED
→ TRANSPORTING
→ ARRIVED_HOSPITAL
```

주요 명령은 `DISPATCH_STARTED`, `ARRIVED_SCENE`, `PATIENT_CONTACT`, `SAVE_ASSESSMENT_FACTS`, `HOSPITAL_REQUEST_VIEWED`, `HOSPITAL_RESPONSE_RECORDED`, `DESTINATION_CONFIRMED_BY_PARAMEDIC`, `TRANSPORT_STARTED`, `ARRIVED_HOSPITAL`입니다.

수동 평가 저장은 AI 경로가 아닙니다. 서버가 구조화된 값과 필수 항목을 검증하고, 구급대원의 Cognito 주체로 바로 확정합니다.

## DynamoDB 단일 테이블

- 파티션: `PK=CASE#{caseId}`
- 사건 메타: `SK=META`
- 확정 환자정보: `SK=STATE#CONFIRMED`
- 이벤트: `SK=EVENT#{occurredAt}#{eventId}`
- 병원 요청: `SK=HOSPITAL_REQUEST#{requestId}`
- 매칭 작업과 기관정보 캐시도 같은 사건·캐시 파티션에 저장
- `ParamedicCasesIndex`: 구급대원 배정 사건 목록
- `HospitalInboxIndex`: 병원별 요청 목록

테이블은 온디맨드 과금, 서버 측 암호화, PITR, TTL을 사용합니다. 사용자 역할과 사건 접근은 요청 본문이 아니라 Cognito identity에서 확인합니다.

## 병원 매칭

1. 구급대원이 확정 환자 카드와 현장 좌표로 매칭을 시작합니다.
2. AppSync Lambda가 작업을 DynamoDB에 기록하고 SQS에 보냅니다.
3. Matching Lambda가 NMC/HIRA 기관정보와 Kakao 거리·ETA를 조회합니다.
4. 현재 반경 안에서 ETA 우선, 미요청 병원 최대 3곳에 동시에 요청합니다.
5. 수용 가능 회신이나 이송지 선택이 없으면 45초 뒤 반경을 확대합니다.
6. 반경은 `15 → 30 → 60 → 120 km` 순으로 확대합니다.
7. 첫 `ACCEPTED` 회신 또는 최종 이송지 선택 시 후속 확대를 중단합니다.

NMC/HIRA 값은 병원의 환자별 수용 여부가 아닙니다. `ACCEPTED`와 `DECLINED`는 Cognito 병원 계정의 명시적 회신으로만 저장합니다.

## 음성과 HITL

- Transcribe Streaming 연결은 `ko-KR`, PCM, 16 kHz입니다.
- 서버는 원본 WAV/PCM을 저장하지 않습니다.
- 명확한 활력징후 발화는 규칙 기반 fast path를 우선 사용합니다.
- 자유 구어체는 Bedrock의 Anthropic Claude 모델이 허용된 환자 필드의 변경안만 만듭니다.
- 생성 결과는 항상 `status=PENDING`, `requiresHumanReview=true`입니다.
- 모델은 확정 상태, 병원 회신, 이송지를 직접 쓸 권한이 없습니다.

## 외부 API와 secret

Secrets Manager의 `ems-relay/external-api-keys`는 Matching Lambda만 읽습니다. 허용되는 설정 이름은 다음과 같습니다.

- 공공데이터 포털 service key의 encoded/decoded 형태
- Kakao Mobility REST API key
- 선택적 NMC/HIRA/Kakao endpoint override

비밀값은 코드·문서·로그·브라우저 번들에 기록하지 않습니다. Kakao 지도 JavaScript 키는 프론트 빌드용 공개 식별자이며 Kakao Developers의 사이트 도메인 제한을 적용해야 합니다.

## 로컬 검증

```powershell
cd backend
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run sam:validate
npm.cmd run sam:build
```

직접 SAM 명령을 사용할 때도 반드시 `template-v2.yaml`을 지정합니다.

```powershell
sam.cmd validate --lint --template-file template-v2.yaml
sam.cmd build --template-file template-v2.yaml --build-dir .aws-sam-v2/build
```

## 배포

저장소 루트의 보호 스크립트가 계정·리전·스택·Amplify 대상, Bedrock 모델 권한, Cognito callback을 검증하고 백엔드와 프론트를 함께 배포합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/deploy-seoul-v2.ps1 -SkipSeed
```

배포 출력은 `GraphQLApiId`, `GraphQLUrl`, `GraphQLRealtimeUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain`, `CaseTableName`, `MatchingQueueUrl`입니다.
