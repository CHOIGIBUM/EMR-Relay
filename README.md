# EMS Relay

EMS Relay는 강원 영동권의 고령 뇌졸중 의심 환자를 대상으로, 구급대원과 병원이 같은 환자 확인본을 보며 수용 가능 병원을 빠르게 연결하는 서버리스 MVP입니다. 구급대원이 병원을 한 곳씩 전화하는 대신 가까운 병원에 동시에 수용 요청을 보내고, 병원의 `수용 가능` 회신 가운데 최종 이송지를 직접 선택합니다.

현재 기준 시스템에는 이송조정 상황실과 구급활동일지 자동 작성이 포함되지 않습니다. 사용자는 **구급대원**과 **병원 수용 담당자** 두 역할뿐입니다.

## 운영 화면

- 운영 서비스: [https://main.d1b1dqlcfz85e3.amplifyapp.com](https://main.d1b1dqlcfz85e3.amplifyapp.com)
- `/` — 로그인 진입
- `/login` — Cognito 업무 계정 로그인
- `/auth/callback` — 로그인 완료 처리
- `/paramedic` — 구급대원 모바일 화면
- `/hospital` — 병원 수용 웹 화면

운영 화면은 Cognito 로그인과 역할 검사를 통과해야 열립니다. 비밀번호나 API 키는 저장소 문서에 기록하지 않습니다.

## 업무 흐름

```text
119 출동 사건 선택
→ 출동 시작 → 현장 도착 → 환자 접촉
→ 기본 평가 → CPSS → 활력징후·시간 입력
→ 구급대원 환자 카드 확정
→ 근거리 병원 동시 요청
→ 무응답·전부 거절 시 15 → 30 → 60 → 120 km로 점진 확대
→ 병원 담당자가 환자 카드 열람 후 수용 가능/곤란 회신
→ 구급대원이 수용 가능 병원 중 최종 이송지 선택
→ Kakao 경로 확인 → 이송 시작 → 병원 도착
```

시연 사건은 `GW-STROKE-001`, `GW-STROKE-002`, `GW-STROKE-003` 세 건입니다. 사건의 환자·임상 내용은 합성 데이터이며, 병원 기관정보와 도로 거리·ETA는 외부 참고 API를 호출할 수 있습니다.

## 환자 입력과 HITL

- 수동 입력은 이미 구조화된 값이므로 AI를 거치지 않고 검증 후 저장합니다.
- PTT 음성은 Amazon Transcribe Streaming으로 한국어 문장으로 변환합니다.
- 명확한 활력징후 문장은 규칙 기반으로 먼저 구조화해 응답 시간을 줄입니다.
- 그 밖의 구어체 발화만 Amazon Bedrock의 Anthropic Claude 모델이 변경안을 만듭니다.
- 음성 결과는 항상 `PENDING` 변경안입니다. 구급대원이 선택한 항목만 확정 상태에 반영됩니다.
- AI는 진단, 치료, 병원 수용 여부, 최종 이송지를 결정하지 않습니다.

## AWS 구성

```text
Amplify Hosting
  └─ Cognito 로그인
      └─ AppSync GraphQL·Subscription
          ├─ 업무 Lambda ── DynamoDB
          ├─ 음성 Lambda ── Transcribe Streaming / Bedrock
          └─ SQS ── 매칭 Lambda ── NMC / HIRA / Kakao
```

- **Amplify Hosting**: Next.js 정적 프론트 배포
- **Cognito**: 구급대원·병원 역할 인증
- **AppSync**: GraphQL 명령·조회와 Cognito JWT 기반 WebSocket 변경 알림
- **Lambda**: 업무 명령, 음성 변경안, 병원 매칭 처리
- **DynamoDB**: 사건, 확정 환자정보, 이벤트, 병원 요청 상태의 단일 저장소
- **SQS**: 병원 매칭과 다음 거리 범위 확대 작업을 비동기로 분리
- **Transcribe Streaming**: 브라우저 PTT의 16 kHz mono PCM 한국어 인식
- **Bedrock**: 구어체 발화를 검토 가능한 구조화 변경안으로 변환
- **NMC·HIRA**: 병원 기관·진료역량 참고정보
- **Kakao Mobility**: 도로 거리·ETA·길안내 참고정보

NMC/HIRA 현황은 병원의 환자별 수용 의사를 의미하지 않습니다. `수용 가능`은 해당 병원 계정의 명시적 회신으로만 생성됩니다.

운영 프론트는 구급대원에게 배정된 각 사건의 `onCaseUpdate`와 병원 계정의 `custom:hospital_id`에 해당하는 `onHospitalInbox`만 구독합니다. WebSocket이 끊기거나 인증 갱신 중이면 2초 조회 방식으로 자동 전환하고, 재연결되면 중복 조회를 중단합니다.

## 로컬 실행

Node.js 22 환경에서 다음 중 하나를 사용합니다.

```powershell
./RUN_LOCAL_MVP.bat
```

또는:

```powershell
npm.cmd install
$env:NEXT_PUBLIC_EMS_DATA_MODE = "local"
$env:NEXT_PUBLIC_EMS_DEV_AUTH = "true"
npm.cmd run dev
```

브라우저에서 `http://localhost:3000/login`을 열고 로컬 개발 역할을 선택합니다. 로컬 모드는 브라우저 fixture를 사용하므로 AWS 계정이나 실제 외부 API가 없어도 두 역할의 흐름을 확인할 수 있습니다.

자세한 내용은 [LOCAL_MVP.md](./LOCAL_MVP.md)와 [실행_및_시연_안내.txt](./실행_및_시연_안내.txt)를 참고합니다.

## 검증

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test

Push-Location backend
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run sam:validate
npm.cmd run sam:build
Pop-Location
```

## 배포

현재 운영 리전은 서울(`ap-northeast-2`)이며 전체 배포는 보호 검사를 포함한 스크립트로 수행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/deploy-seoul-v2.ps1 -SkipSeed
```

세 시연 사건을 초기 상태로 다시 만들 때만 `-ResetSeed`와 배포된 병원 ID 세 개를 명시합니다. 자세한 절차는 [docs/OPERATIONS.md](./docs/OPERATIONS.md)에 있습니다.

## 안전 경계

- 실제 환자정보를 저장소, 스크린샷, 로그, 테스트 fixture에 넣지 않습니다.
- 브라우저에는 Kakao JavaScript 키 외의 비밀값을 넣지 않습니다.
- 공공데이터 인증키와 Kakao REST 키는 Secrets Manager에서 매칭 Lambda만 읽습니다.
- 음성 원본 WAV/PCM은 S3에 저장하지 않습니다.
- 미확인 값은 임의로 채우지 않고 `미확인` 또는 `평가 불가`로 유지합니다.
- 환자정보가 포함될 수 있는 로그 본문을 CloudWatch에 출력하지 않습니다.

## 문서

- [업무 흐름](./WORKFLOW.md)
- [백엔드 구조](./backend/README.md)
- [운영·배포 절차](./docs/OPERATIONS.md)
- [배포 아키텍처 PNG](./docs/architecture/ems-relay-deployed-architecture-v2.png)
- [배포 아키텍처 draw.io](./docs/architecture/ems-relay-deployed-architecture-v2.drawio)
