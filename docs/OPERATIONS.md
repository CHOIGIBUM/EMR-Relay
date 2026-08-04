# EMS Relay Seoul v2 운영 절차

현재 운영 기준은 AWS CLI profile `ems-relay-cgb`, 서울 리전 `ap-northeast-2`, CloudFormation 스택 `ems-relay-seoul-v2`, Amplify 앱 `ems-relay-seoul-v2`입니다.

이 문서의 명령에 AWS 자격 증명, 사용자 비밀번호, 공공데이터 인증키, Kakao REST/Admin 키를 직접 입력하거나 출력하지 않습니다.

## 1. 필수 도구

- AWS CLI v2
- AWS SAM CLI
- Node.js 22
- PowerShell 5.1 이상
- Python 3.12 이상
- `curl.exe`

## 2. 계정과 대상 확인

```powershell
Set-Location "<EMS_Relay_MVP 저장소 경로>"

$Profile = "ems-relay-cgb"
$Region = "ap-northeast-2"
$ExpectedAccount = "462993243992"
$Stack = "ems-relay-seoul-v2"
$AmplifyAppId = "d1b1dqlcfz85e3"
$SiteUrl = "https://main.d1b1dqlcfz85e3.amplifyapp.com"

$Identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($Identity.Account -ne $ExpectedAccount) { throw "AWS account mismatch" }
if ($Identity.Arn -ne "arn:aws:iam::${ExpectedAccount}:user/CGB") { throw "AWS IAM user mismatch" }
```

배포 스크립트도 같은 계정, 사용자, 리전, 스택과 Amplify 앱을 다시 검사하며 다른 대상에는 쓰지 않습니다.

## 3. secret 관리

외부 API secret 이름은 `ems-relay/external-api-keys`입니다. 값은 조회하거나 콘솔에 출력하지 않고 메타데이터만 확인합니다.

```powershell
aws secretsmanager describe-secret `
  --secret-id ems-relay/external-api-keys `
  --profile $Profile --region $Region `
  --query '{Name:Name,ARN:ARN,LastChangedDate:LastChangedDate}'
```

- 공공데이터 인증키와 Kakao Mobility REST 키는 Matching Lambda만 사용합니다.
- Kakao Admin 키는 사용하지 않습니다.
- 브라우저에는 도메인 제한을 건 Kakao JavaScript 키만 빌드 시 전달할 수 있습니다.
- 시연 계정 암호는 Secrets Manager 또는 승인된 암호 관리 위치에서만 관리합니다.

## 4. 배포 전 검증

### 프론트

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```

### 백엔드

```powershell
Push-Location backend
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run sam:validate
npm.cmd run sam:build
Pop-Location
```

백엔드 배포 기준은 `backend/template-v2.yaml`입니다. 삭제된 구형 템플릿 이름을 배포 명령에 사용하지 않습니다.

## 5. 전체 배포

기존 세 시연 사건을 유지하면서 코드와 인프라를 배포합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/deploy-seoul-v2.ps1 -SkipSeed
```

기본값은 시스템 `PATH`의 `python`입니다. 다른 Python 3.12 이상 실행 파일을 사용할 때는 `-PythonCommand "C:\path\to\python.exe"`를 명시합니다.

스크립트는 다음을 순서대로 수행합니다.

1. 로컬 도구·SAM 템플릿·seed script 검증
2. CGB 계정과 Bedrock 모델 사용 가능 여부 검증
3. 외부 API secret의 서울 리전 존재 여부와 메타데이터 검증
4. `template-v2.yaml` 빌드 및 `ems-relay-seoul-v2` 스택 배포
5. AppSync, Cognito, DynamoDB, SQS, Lambda 출력 검증
6. `.env.production`의 공개 프론트 설정 갱신
7. Next.js 정적 빌드와 Amplify 수동 배포
8. `/login`, `/paramedic`, `/hospital` 응답과 Cognito callback 검증

### 세 시연 사건 재설정

실제 시연 상태를 버리고 `GW-STROKE-001`~`003`을 초기화할 때만 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/deploy-seoul-v2.ps1 `
  -ResetSeed `
  -HospitalIds @("A2200012", "A2200011", "A2200003")
```

이 명령은 정확히 세 사건 파티션만 지운 뒤 다시 생성합니다. 다른 사건이나 테이블 전체를 삭제하지 않습니다. paramedic 그룹에 사용자가 한 명이 아니면 `-ParamedicSub`를 명시해야 합니다.

### 프론트만 재배포

백엔드 출력과 `.env.production`이 이미 최신일 때만 사용합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/publish-frontend-v2.ps1
```

## 6. 배포 후 상태 확인

```powershell
aws cloudformation describe-stacks --stack-name $Stack `
  --profile $Profile --region $Region `
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'

aws amplify list-jobs --app-id $AmplifyAppId --branch-name main --max-items 1 `
  --profile $Profile --region $Region `
  --query 'jobSummaries[0].{JobId:jobId,Status:status,EndTime:endTime}'

Invoke-WebRequest "$SiteUrl/login/" -UseBasicParsing
Invoke-WebRequest "$SiteUrl/paramedic/" -UseBasicParsing
Invoke-WebRequest "$SiteUrl/hospital/" -UseBasicParsing
```

브라우저 개발자 도구의 Network에서 AppSync realtime 주소에 `101 Switching Protocols`가 표시되고, 구급대원 사건 변경 또는 병원 회신 직후 별도 새로고침 없이 상대 화면이 갱신되는지 확인합니다. WebSocket을 차단한 상태에서는 2초 이내 최신 상태가 조회되어야 하며, 연결이 복구되면 주기 조회는 자동 중단됩니다.

기대값은 CloudFormation `CREATE_COMPLETE` 또는 `UPDATE_COMPLETE`, 최신 Amplify job `SUCCEED`, 각 URL의 HTTP 2xx입니다.

## 7. 브라우저 E2E 검증

최신 배포에서 다음을 실제로 확인합니다.

1. 구급대원 Cognito 로그인
2. 병원 Cognito 로그인
3. 구급대원 사건 3건 표시
4. 수동 환자 입력과 입력 시각 보존
5. PTT 인식 문장과 `PENDING` 변경안의 사람 검토
6. 근거리 병원 동시 요청
7. 병원 요청 실시간 수신과 환자 카드 열람
8. 병원 `수용 가능` 회신
9. 구급대원 화면에 회신 반영, 자동 확대 중단, 최종 병원 선택
10. Kakao 지도·경로 표시
11. 이송 시작과 병원 도착이 양쪽 화면에 반영

각 단계의 스크린샷은 `docs/test-runs/` 아래에 저장하되 실제 환자정보를 포함하지 않습니다.

검증을 모두 완료한 뒤에만 E2E gate를 기록합니다. 아래 `<스크린샷 경로>`는 실제 파일 경로로 교체합니다.

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/write-seoul-v2-e2e-verification.ps1 `
  -ParamedicCognitoLogin `
  -HospitalCognitoLogin `
  -ThreeCasesLoaded `
  -ManualPatientInput `
  -HospitalYesResponse `
  -ParamedicHospitalSelection `
  -TransportStarted `
  -HospitalArrivalCompleted `
  -KakaoMapRendered `
  -EvidenceFiles <스크린샷 경로> `
  -ApproveEndToEndRun
```

배포 성공 기록만으로는 E2E gate가 생성되지 않습니다.

## 8. Kakao 지도 확인

Kakao Developers의 JavaScript SDK 사이트 도메인에 다음 주소가 정확히 등록되어 있어야 합니다.

```text
https://main.d1b1dqlcfz85e3.amplifyapp.com
```

`domain_mismatched`가 보이면 키를 바꾸기 전에 사이트 도메인부터 확인합니다. REST/Admin 키는 브라우저에 넣지 않습니다.

## 9. 관찰과 장애 대응

### Lambda 로그 그룹

```powershell
aws logs describe-log-groups `
  --log-group-name-prefix /aws/lambda/ems-relay-seoul-v2 `
  --profile $Profile --region $Region `
  --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,Bytes:storedBytes}'
```

로그 본문에 환자정보, transcript, presigned URL, secret을 추가하지 않습니다.

### 매칭 큐

```powershell
$QueueUrl = aws cloudformation describe-stacks --stack-name $Stack `
  --profile $Profile --region $Region `
  --query "Stacks[0].Outputs[?OutputKey=='MatchingQueueUrl'].OutputValue | [0]" `
  --output text

aws sqs get-queue-attributes --queue-url $QueueUrl `
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible `
  --profile $Profile --region $Region
```

- 메시지가 계속 쌓이면 Matching Lambda 오류와 외부 API timeout을 확인합니다.
- 첫 수용 가능 회신 뒤 새 wave가 생성되면 `shouldStopExpansion` 경로와 사건 상태를 확인합니다.
- SQS 재시도 실패는 배포 스택의 dead-letter queue에서 건수만 확인하고 환자 본문을 출력하지 않습니다.

### 음성 지연

- 수동 입력은 음성/Bedrock 경로를 타지 않는지 먼저 확인합니다.
- 명확한 활력징후 문장은 규칙 기반 fast path가 사용되는지 확인합니다.
- 자유 발화만 Bedrock으로 보내며 프론트 요청 제한은 15초, 모델 내부 제한은 8초입니다.
- 변경안 실패 시 기존 확정 환자정보는 변경되지 않아야 합니다.

## 10. 운영 원칙

- AWS와 외부 API는 실제 환자정보가 아닌 승인된 합성 시연 데이터로만 검증합니다.
- NMC/HIRA 의료자원 값으로 병원 수용 가능 여부를 추정하거나 표시하지 않습니다.
- 병원의 명시적 `수용 가능` 회신과 구급대원의 최종 선택을 각각 이벤트로 남깁니다.
- 배포 후 `.env.production`, 빌드 산출물, 로그에 비밀값이 포함되지 않았는지 확인합니다.
- 리소스 삭제는 별도의 최신 E2E gate와 명시적 승인 없이 수행하지 않습니다.
