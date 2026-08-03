# EMS Relay backend

AWS SAM 기반의 인증·사건 동기화·음성 구조화·병원 회신·구급활동일지·FHIR 백엔드입니다. AI는 `PENDING` 변경안과 초안만 만들며, 임상정보와 보고서는 권한이 있는 사용자의 명시적 확인 없이는 확정되지 않습니다.

## 안전 경계

- `/health`를 제외한 HTTP API는 Cognito JWT가 필요합니다.
- actor, role, 병원 ID는 요청 본문이 아니라 JWT claims에서 가져옵니다.
- AgentCore와 직접 Bedrock fallback 모두 확정 상태를 쓰지 못합니다.
- NMC/HIRA는 기관 참고정보, Kakao Mobility는 거리·ETA 참고정보입니다. 실시간 수용 여부나 병원 추천 점수가 아닙니다.
- Transcribe Streaming은 브라우저가 16 kHz mono PCM을 AWS로 직접 전송합니다. 서버는 raw WAV/PCM을 저장하지 않습니다.
- WebSocket에는 환자정보 대신 사건 버전 변경 알림만 전송합니다. 알림을 받은 클라이언트는 `GET /cases/{id}`를 다시 조회합니다.
- HealthLake에는 사람이 최종 확정한 구급활동일지만 FHIR R4 transaction Bundle로 발행합니다.

## 주요 API

| Method | Path | 역할 |
|---|---|---|
| GET | `/health` | 공개 상태 확인 |
| GET | `/cases/{id}` | 권위 사건 스냅샷 조회 |
| POST | `/cases/{id}/commands` | 역할별 사건 상태 명령 |
| POST | `/cases/{id}/realtime-session` | 5분 유효 1회용 WebSocket ticket |
| POST | `/transcribe/session` | 300초 Transcribe Streaming presigned WSS |
| POST | `/cases/{id}/voice-updates/proposals` | 음성 문장의 AI 변경안 생성 |
| POST | `/cases/{id}/confirm` | 구급대원 HITL 확정 |
| GET | `/hospitals?case_id=&lat=&lng=` | NMC/HIRA/Kakao 참고정보 |
| GET | `/cases/{id}/report` | 최신 구급활동일지 조회 |
| POST | `/cases/{id}/report/draft` | 별지 제5호서식 기반 구조화 초안 생성 |
| POST | `/cases/{id}/report/review` | 섹션별 사람 검토 저장 |
| POST | `/cases/{id}/report/finalize` | 최종 확정 및 S3 JSON/HTML 보관 |
| POST | `/cases/{id}/fhir/publish` | 최종 확정 보고서 FHIR 발행 |

`POST /cases/{id}/commands` 계약:

```json
{
  "commandId": "01J...",
  "type": "PATIENT_CONTACT",
  "expectedVersion": 3,
  "payload": {}
}
```

지원 lifecycle은 `CASE_ASSIGNED → DISPATCH_STARTED → ARRIVED_SCENE → PATIENT_CONTACT → PATIENT_FACTS_CONFIRMED → HOSPITAL_REQUEST_CREATED → HOSPITAL_RESPONSE_RECORDED → DESTINATION_CONFIRMED_BY_PARAMEDIC → TRANSPORT_STARTED → REASSESSMENT_CONFIRMED → ARRIVED_HOSPITAL → HANDOFF_SENT → HANDOFF_ACCEPTED`입니다. 병원 추가정보 요청/회신과 보고서 이벤트도 동일 event log에 기록됩니다.

## 인증 역할

- `paramedic`: 배정 사건의 환자정보 검토, 병원 문의, 이송지 확정, 이송·인계, 보고서 검토
- `hospital`: 자신의 `custom:hospital_id`에 온 문의 열람, 추가정보 요청, 수용/곤란 회신, 인수 확인
- `control`: 사건 배정과 조회
- `admin`: 운영 관리

SPA client는 secret 없이 Authorization Code + PKCE를 사용합니다. User Pool groups가 JWT의 `cognito:groups`에 포함됩니다.

## 외부 API secret

Secrets Manager의 `ems-relay/external-api-keys` JSON은 다음 키를 사용합니다. 값과 presigned URL은 로그에 남기지 않습니다.

```json
{
  "NMC_SERVICE_KEY": "...",
  "NMC_BASE_URL": "https://apis.data.go.kr/...",
  "HIRA_SERVICE_KEY": "...",
  "HIRA_BASE_URL": "https://apis.data.go.kr/...",
  "KAKAO_REST_API_KEY": "...",
  "KAKAO_DIRECTIONS_URL": "https://apis-navi.kakaomobility.com/v1/directions"
}
```

## 환경 변수

SAM이 다음 변수를 구성합니다.

- `TABLE_NAME`, `CONNECTION_TABLE_NAME`, `REPORT_BUCKET`
- `BEDROCK_MODEL_ID`, `BEDROCK_REGION`
- `AGENT_RUNTIME_ARN`, `AGENT_RUNTIME_QUALIFIER`
- `ALLOW_DIRECT_BEDROCK_FALLBACK` — `true`일 때만 직접 Bedrock 허용
- `EXTERNAL_API_SECRET_NAME`
- `WEBSOCKET_URL`, `WEBSOCKET_MANAGEMENT_ENDPOINT`
- `TRANSCRIBE_REGION`
- `HEALTHLAKE_DATASTORE_ENDPOINT`, `HEALTHLAKE_REGION`

## 검증

```powershell
cd backend
npm.cmd install
npm.cmd run typecheck
npm.cmd test

$env:SAM_CLI_TELEMETRY='0'
$env:__SAM_CLI_APP_DIR=(Resolve-Path '.sam-cli-config').Path
sam.cmd validate --lint --template-file template.yaml
sam.cmd build --template-file template.yaml
```

## 배포 출력

- `ApiUrl`, `WebSocketUrl`
- `UserPoolId`, `UserPoolClientId`, `CognitoIssuer`, `CognitoManagedLoginDomain`
- `CaseTableName`, `ConnectionTableName`, `ReportBucketName`, `FunctionName`

HealthLake는 빈 datastore도 시간당 비용이 발생하므로 별도 lifecycle로 만들고 `HealthLakeDatastoreArn`/`HealthLakeDatastoreEndpoint`만 이 스택에 전달하는 구성을 권장합니다.
