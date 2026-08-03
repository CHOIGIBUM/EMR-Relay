# EMS Relay 운영 절차

이 문서는 `ems-relay-cgb` AWS CLI profile, 계정 `462993243992`, 리전 `us-west-2` 전용이다. 명령에 access key, 비밀번호, 공공데이터 key, Kakao key를 직접 넣거나 출력하지 않는다.

필수 도구는 AWS CLI v2, AWS SAM CLI, Node.js 22, Python 3.12, Amazon Bedrock AgentCore CLI다. 프론트는 AWS Amplify Hosting의 수동 정적 배포를 사용한다.

## 1. 공통 변수와 계정 보호

PowerShell에서 저장소 루트로 이동한 뒤 시작한다.

```powershell
Set-Location "C:\Users\CGB\OneDrive - KNU\바탕 화면\triage\EMS_Relay_MVP"

$Profile = "ems-relay-cgb"
$Region = "us-west-2"
$ExpectedAccount = "462993243992"
$Stack = "ems-relay-backend"
$SiteUrl = "https://main.d2edch3bt6kxej.amplifyapp.com"
$AmplifyAppId = "d2edch3bt6kxej"
$AgentRuntimeId = "EMSRelayProposal-plEVqA20bj"
$HealthLakeId = "b93de77cda6c8d6b8c6663df64d89bec"

$ActualAccount = (aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if ($ActualAccount -ne $ExpectedAccount) {
  throw "AWS account mismatch: expected $ExpectedAccount, got $ActualAccount"
}
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = $Region
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
aws configure get region --profile $Profile
```

region 출력이 다르더라도 아래 모든 AWS 명령에는 `--region $Region`을 계속 명시한다.

## 2. secret 관리

사용하는 secret 이름은 다음 두 개뿐이다.

- `ems-relay/external-api-keys`
- `ems-relay/demo-users`

외부 API secret이 허용하는 key 이름:

- `DATA_GO_KR_SERVICE_KEY_DECODED`
- `DATA_GO_KR_SERVICE_KEY_ENCODED`
- `KAKAO_MOBILITY_REST_API_KEY`
- `KAKAO_MAP_JAVASCRIPT_KEY`
- 선택적 override: `NMC_BASE_URL`, `HIRA_BASE_URL`, `KAKAO_DIRECTIONS_URL`

메타데이터만 확인한다. 운영 로그나 화면 녹화 중에는 `get-secret-value`를 실행하지 않는다.

```powershell
aws secretsmanager describe-secret `
  --secret-id ems-relay/external-api-keys `
  --profile $Profile --region $Region `
  --query '{Name:Name,ARN:ARN,LastChangedDate:LastChangedDate}'

aws secretsmanager describe-secret `
  --secret-id ems-relay/demo-users `
  --profile $Profile --region $Region `
  --query '{Name:Name,ARN:ARN,LastChangedDate:LastChangedDate}'
```

Kakao JavaScript key는 브라우저에 전달되는 공개 식별자이므로 반드시 Kakao Developers에서 SDK 도메인을 제한한다. Admin key는 이 프로젝트에서 사용하지 않는다.

## 3. 로컬 검증

### 3.1 프론트

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```

### 3.2 백엔드

```powershell
Push-Location backend
npm.cmd ci
npm.cmd run typecheck
npm.cmd test

$env:SAM_CLI_TELEMETRY = "0"
$env:__SAM_CLI_APP_DIR = (Resolve-Path ".sam-cli-config").Path
sam.cmd validate --lint --template-file template.yaml
sam.cmd build --template-file template.yaml
Pop-Location
```

### 3.3 AgentCore

```powershell
Push-Location agentcore
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m pytest `
  --cov=ems_relay_agentcore --cov=main --cov-fail-under=85
.\.venv\Scripts\python.exe -m ruff check .
agentcore validate
Pop-Location
```

## 4. 배포 순서

배포 순서는 AgentCore → HealthLake 상태 확인 → SAM backend → Amplify frontend다. Backend에 전달하는 AgentCore ARN과 HealthLake endpoint가 달라지면 반드시 backend를 다시 배포한다.

### 4.1 AgentCore 배포/갱신

우선 checked-in `agentcore/agentcore/agentcore.json`과 공식 CLI를 사용한다.

```powershell
Push-Location agentcore
agentcore deploy --dry-run
agentcore deploy
Pop-Location
```

Windows host-native wheel이 들어가 Runtime이 시작되지 않는 경우에는 Python 3.12 ARM64 wheel을 포함한 CodeZip을 만들어 기존 Runtime을 갱신한다. stale S3 version ID를 재사용하지 않는다.

```powershell
$AgentRoot = (Resolve-Path "agentcore").Path
$PackageRoot = Join-Path $env:TEMP "ems-relay-agentcore-arm64"
$ZipPath = Join-Path $env:TEMP "ems-relay-agentcore-arm64.zip"

if (Test-Path $PackageRoot) { Remove-Item -LiteralPath $PackageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $PackageRoot | Out-Null

py -3.12 -m pip install `
  --platform manylinux2014_aarch64 `
  --implementation cp --python-version 3.12 --abi cp312 `
  --only-binary=:all: `
  --target $PackageRoot `
  -r (Join-Path $AgentRoot "requirements.txt")

Copy-Item (Join-Path $AgentRoot "main.py") $PackageRoot
Copy-Item (Join-Path $AgentRoot "ems_relay_agentcore") $PackageRoot -Recurse
if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -Path (Join-Path $PackageRoot "*") -DestinationPath $ZipPath

$ArtifactBucket = "bedrock-agentcore-code-462993243992-us-west-2"
$ArtifactKey = "EMSRelayProposal/ems-relay-agentcore.zip"
aws s3 cp $ZipPath "s3://$ArtifactBucket/$ArtifactKey" `
  --profile $Profile --region $Region | Out-Null
$VersionId = aws s3api head-object --bucket $ArtifactBucket --key $ArtifactKey `
  --profile $Profile --region $Region --query VersionId --output text
```

`tmp/update-agent-runtime.json`의 S3 `versionId`를 방금 받은 값으로 바꾼 뒤 갱신한다. 이 JSON에는 credential이 없어야 한다.

```powershell
aws bedrock-agentcore-control update-agent-runtime `
  --cli-input-json file://tmp/update-agent-runtime.json `
  --profile $Profile --region $Region

aws bedrock-agentcore-control get-agent-runtime `
  --agent-runtime-id $AgentRuntimeId `
  --profile $Profile --region $Region `
  --query '{Status:status,Arn:agentRuntimeArn,Updated:lastUpdatedAt}'
```

`Status`가 `READY`인지 확인한다.

### 4.2 HealthLake 생성 또는 상태 확인

현재 datastore를 재사용할 때:

```powershell
aws healthlake describe-fhir-datastore `
  --datastore-id $HealthLakeId `
  --profile $Profile --region $Region `
  --query 'DatastoreProperties.{Status:DatastoreStatus,Arn:DatastoreArn,Endpoint:DatastoreEndpoint}'
```

삭제 후 새로 만들 때만 다음을 실행한다. 생성 결과의 ID·ARN·endpoint를 backend 배포 변수에 반영한다.

```powershell
aws healthlake create-fhir-datastore `
  --datastore-name EMSRelayFHIR `
  --datastore-type-version R4 `
  --tags Key=Project,Value=EMSRelay Key=Environment,Value=Hackathon `
  --profile $Profile --region $Region
```

`CREATING` 동안 backend에 연결하지 말고 `ACTIVE`가 될 때까지 `describe-fhir-datastore`로 확인한다.

### 4.3 SAM backend 배포

```powershell
$ModelId = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
$AgentRuntimeArn = "arn:aws:bedrock-agentcore:us-west-2:462993243992:runtime/EMSRelayProposal-plEVqA20bj"
$HealthLakeArn = "arn:aws:healthlake:us-west-2:462993243992:datastore/fhir/b93de77cda6c8d6b8c6663df64d89bec"
$HealthLakeEndpoint = "https://healthlake.us-west-2.amazonaws.com/datastore/b93de77cda6c8d6b8c6663df64d89bec/r4/"

Push-Location backend
.\scripts\deploy.ps1 `
  -StackName $Stack `
  -Profile $Profile `
  -Region $Region `
  -ExpectedAccountId $ExpectedAccount `
  -ModelId $ModelId `
  -CorsOrigins "http://localhost:3000,$SiteUrl" `
  -AgentRuntimeArn $AgentRuntimeArn `
  -AgentRuntimeQualifier "DEFAULT" `
  -AllowDirectBedrockFallback "false" `
  -HealthLakeDatastoreArn $HealthLakeArn `
  -HealthLakeDatastoreEndpoint $HealthLakeEndpoint `
  -CognitoCallbackUrls "http://localhost:3000/auth/callback,$SiteUrl/auth/callback" `
  -CognitoLogoutUrls "http://localhost:3000/login,$SiteUrl/login"
Pop-Location
```

현재 Runtime endpoint는 template의 `AgentRuntimeEndpointArn` 기본값 `.../runtime-endpoint/DEFAULT`와 일치한다. Runtime을 교체하면 template 기본값 또는 배포 parameter도 함께 바꿔야 한다.

### 4.4 AWS Amplify 프론트 배포

프론트는 Next.js 정적 export 결과인 `out/`을 AWS Amplify Hosting에 배포한다. `NEXT_PUBLIC_*` 값은 브라우저 번들에 공개되므로 공공데이터 인증키, Kakao REST/Admin 키, AWS credential을 넣지 않는다.

```text
NEXT_PUBLIC_EMS_API_MODE=remote
NEXT_PUBLIC_EMS_BACKEND_URL=https://322rrfmbme.execute-api.us-west-2.amazonaws.com
NEXT_PUBLIC_EMS_ALLOW_LOCAL_FALLBACK=false
NEXT_PUBLIC_EMS_OPERATIONAL_MODE=remote
NEXT_PUBLIC_EMS_DEFAULT_CASE_ID=GW-CARDIO-051
NEXT_PUBLIC_EMS_ALLOW_DEVELOPMENT_FALLBACK=false
NEXT_PUBLIC_EMS_SCRIPTED_PTT=false
NEXT_PUBLIC_COGNITO_DOMAIN=https://ems-relay-462993243992-us-west-2.auth.us-west-2.amazoncognito.com
NEXT_PUBLIC_COGNITO_CLIENT_ID=3g1ruv6gk8rd63iea0q5i4fiu
NEXT_PUBLIC_COGNITO_REDIRECT_URI=https://main.d2edch3bt6kxej.amplifyapp.com/auth/callback
NEXT_PUBLIC_COGNITO_LOGOUT_URI=https://main.d2edch3bt6kxej.amplifyapp.com/login
NEXT_PUBLIC_EMS_DEV_AUTH=false
NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY=<공개 JavaScript 키만 빌드 시 주입>
```

```powershell
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-amplify.ps1 `
  -AppId $AmplifyAppId `
  -BranchName main `
  -Profile $Profile `
  -Region $Region `
  -ExpectedAccountId $ExpectedAccount
```

Amplify 주소 자체는 공개되어 있지만 실제 역할 화면과 API는 Cognito 로그인 및 백엔드 객체 권한 검사를 거쳐야 한다.

배포 후 Kakao Developers → 앱 → 플랫폼 키/JavaScript SDK → 사이트 도메인이 아래 주소와 정확히 일치하는지 확인한다. 현재 운영 앱에는 이 주소가 등록되어 있다.

```text
https://main.d2edch3bt6kxej.amplifyapp.com
```

## 5. 배포 검증

### 5.1 stack과 서비스 상태

```powershell
aws cloudformation describe-stacks --stack-name $Stack `
  --profile $Profile --region $Region `
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'

Invoke-RestMethod "https://322rrfmbme.execute-api.us-west-2.amazonaws.com/health" |
  ConvertTo-Json -Depth 8

aws bedrock-agentcore-control get-agent-runtime `
  --agent-runtime-id $AgentRuntimeId `
  --profile $Profile --region $Region `
  --query '{Status:status,Arn:agentRuntimeArn}'

aws healthlake describe-fhir-datastore `
  --datastore-id $HealthLakeId `
  --profile $Profile --region $Region `
  --query 'DatastoreProperties.{Status:DatastoreStatus,Endpoint:DatastoreEndpoint}'
```

기대값은 stack `UPDATE_COMPLETE`, backend `status=ok`, AgentCore `READY`, HealthLake `ACTIVE`, `agent.agentRuntimeConfigured=true`, `agent.directBedrockFallbackEnabled=false`, `audioStorage=disabled`다.

### 5.2 운영용 빈 사건 준비

Windows PowerShell 5는 BOM 없는 UTF-8 script를 잘못 해석할 수 있다. 아래처럼 UTF-8로 읽은 ScriptBlock을 실행한다.

```powershell
$Seed = [scriptblock]::Create(
  (Get-Content -LiteralPath .\backend\scripts\cloud-e2e-seed.ps1 -Raw -Encoding UTF8)
)

& $Seed -Profile $Profile -Region $Region -Apply `
  -CaseId GW-CARDIO-051 -PrepareInteractiveCase
```

기대값은 `ASSIGNED v1`, 임상 사실 0, 병원 문의 0, 이송지 미선택이다. 병원 데모 계정은 속초의료원 NMC ID `A2200012`에 연결된다.

### 5.3 NMC·HIRA·Kakao 실제 호출

```powershell
& $Seed -Profile $Profile -Region $Region -Apply -DirectoryProbe
```

기대값은 `source=live_reference_apis`, 속초의료원 `source=NMC+HIRA+KAKAO`, `acceptanceStatus=not_provided`다.

### 5.4 WebSocket ticket probe

```powershell
& $Seed -Profile $Profile -Region $Region -Apply -RealtimeProbe
```

기대 출력:

```json
{"connected":true,"protocol":"wss","ticketConsumed":true}
```

### 5.5 완료 파이프라인 재검증

다음 명령은 `GW-CARDIO-050`에 대해 합성 사건을 끝까지 진행하고 Cognito 병원 속성, 사건 상태, S3 보고서, FHIR outbox를 갱신한다. 운영 데이터가 없는 해커톤 환경에서만 실행한다.

```powershell
& $Seed -Profile $Profile -Region $Region -Apply -CaseId GW-CARDIO-050
```

기대값은 stage `COMPLETE`, hospital request `ACCEPTED`, report `FINALIZED`, FHIR outbox `PUBLISHED`, S3 archive 객체 2개다. 이 보관 사건은 UI 시연용이 아니다.

### 5.6 실제 마이크 수동 확인

1. Chrome 또는 Edge에서 서비스 `/login`에 접속한다.
2. 구급대원 계정으로 로그인해 `GW-CARDIO-051`을 연다.
3. 브라우저 마이크 권한을 허용한다.
4. PTT를 누르고 짧은 한국어 현장 업데이트를 말한다.
5. 중앙 오버레이에 부분 문장이 나타나는지 확인한다.
6. 버튼을 놓고 최종 문장과 변경안 검토 화면이 나타나는지 확인한다.
7. 아무 항목도 확정되지 않은 상태에서 DynamoDB confirmed state가 바뀌지 않는지 확인한다.
8. 일부 항목만 선택·확정하고 다른 역할 화면이 WebSocket 알림 뒤 최신 상태를 다시 불러오는지 확인한다.

## 6. 관찰과 장애 대응

### 6.1 Lambda 로그

```powershell
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/ems-relay-backend `
  --profile $Profile --region $Region `
  --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,Bytes:storedBytes}'
```

로그에 transcript, patient facts, presigned URL, secret 값을 추가하지 않는다.

### 6.2 FHIR 실패 큐

```powershell
$FailureQueueUrl = aws cloudformation list-stack-resources --stack-name $Stack `
  --profile $Profile --region $Region `
  --query "StackResourceSummaries[?LogicalResourceId=='StreamFailureQueue'].PhysicalResourceId | [0]" `
  --output text

aws sqs get-queue-attributes --queue-url $FailureQueueUrl `
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible `
  --profile $Profile --region $Region
```

메시지가 있으면 Lambda·HealthLake 상태를 먼저 확인한 후 원본 outbox 상태를 점검한다. 환자 내용을 터미널에 그대로 출력하지 않는다.

## 7. 종료와 비용 정리

> 아래는 파괴적 명령이다. 프로젝트 종료 승인과 필요한 백업을 확인한 뒤 실행한다. 목표 종료 시각은 2026-08-08 09:00 KST다. 현재 stack에는 자동 삭제 Scheduler가 없다.

### 7.1 삭제 전 상태와 백업 대상 확인

```powershell
$ActualAccount = (aws sts get-caller-identity --profile $Profile --query Account --output text).Trim()
if ($ActualAccount -ne $ExpectedAccount) { throw "AWS account mismatch" }

aws healthlake describe-fhir-datastore --datastore-id $HealthLakeId `
  --profile $Profile --region $Region `
  --query 'DatastoreProperties.{Status:DatastoreStatus,Endpoint:DatastoreEndpoint}'

aws s3api list-objects-v2 --bucket ems-relay-backend-reportbucket-gh0aw9yqohil `
  --profile $Profile --region $Region --query '{Count:KeyCount,Keys:Contents[].Key}'
```

### 7.2 HealthLake를 먼저 종료

HealthLake는 `ACTIVE` 동안 비용이 계속 발생하므로 가장 먼저 삭제 요청한다.

```powershell
aws healthlake delete-fhir-datastore --datastore-id $HealthLakeId `
  --profile $Profile --region $Region

aws healthlake describe-fhir-datastore --datastore-id $HealthLakeId `
  --profile $Profile --region $Region `
  --query 'DatastoreProperties.DatastoreStatus'
```

`DELETING`에서 시작해 최종적으로 `DELETED`가 되는지 다시 확인한다.

### 7.3 backend stack 삭제

```powershell
aws cloudformation delete-stack --stack-name $Stack `
  --profile $Profile --region $Region
aws cloudformation wait stack-delete-complete --stack-name $Stack `
  --profile $Profile --region $Region
```

stack 삭제 후에도 `DeletionPolicy: Retain`인 User Pool, 사건 테이블, 보고서 버킷은 남는다.

### 7.4 AgentCore 종료

```powershell
aws bedrock-agentcore-control delete-agent-runtime-endpoint `
  --agent-runtime-id $AgentRuntimeId --endpoint-name DEFAULT `
  --profile $Profile --region $Region

aws bedrock-agentcore-control delete-agent-runtime `
  --agent-runtime-id $AgentRuntimeId `
  --profile $Profile --region $Region

aws logs delete-log-group `
  --log-group-name /aws/bedrock-agentcore/runtimes/EMSRelayProposal-plEVqA20bj-DEFAULT `
  --profile $Profile --region $Region
```

endpoint가 아직 `DELETING`이면 Runtime 삭제를 잠시 뒤 다시 실행한다.

### 7.5 Retain 리소스 완전 삭제

사건·보고서를 보존할 필요가 없다고 명시적으로 승인한 경우에만 실행한다.

```powershell
aws amplify delete-app --app-id $AmplifyAppId `
  --profile $Profile --region $Region
```

```powershell
aws cognito-idp delete-user-pool --user-pool-id us-west-2_U8OPmgc5R `
  --profile $Profile --region $Region

aws dynamodb delete-table --table-name ems-relay-backend-CaseTable-6OEBP7LSGS5G `
  --profile $Profile --region $Region
aws dynamodb wait table-not-exists --table-name ems-relay-backend-CaseTable-6OEBP7LSGS5G `
  --profile $Profile --region $Region
```

버전 관리 S3 bucket은 현재 버전과 delete marker를 모두 지워야 한다. 다음 helper는 **지정한 bucket 전체를 영구 삭제**한다.

```powershell
function Remove-VersionedBucket {
  param([Parameter(Mandatory)][string]$Bucket)
  if ($Bucket -notmatch '^ems-relay-backend-reportbucket-|^bedrock-agentcore-code-462993243992-us-west-2$') {
    throw "Unexpected bucket: $Bucket"
  }
  $listing = aws s3api list-object-versions --bucket $Bucket `
    --profile $Profile --region $Region --output json | ConvertFrom-Json
  foreach ($item in @($listing.Versions) + @($listing.DeleteMarkers)) {
    aws s3api delete-object --bucket $Bucket --key $item.Key --version-id $item.VersionId `
      --profile $Profile --region $Region | Out-Null
  }
  aws s3api delete-bucket --bucket $Bucket --profile $Profile --region $Region
}

Remove-VersionedBucket "ems-relay-backend-reportbucket-gh0aw9yqohil"
Remove-VersionedBucket "bedrock-agentcore-code-462993243992-us-west-2"
```

AgentCore 전용 IAM role을 다른 workload가 사용하지 않는지 확인한 뒤 삭제한다.

```powershell
aws iam list-role-policies --role-name EMSRelayAgentCoreRuntimeRole `
  --profile $Profile

aws iam delete-role-policy --role-name EMSRelayAgentCoreRuntimeRole `
  --policy-name EMSRelayAgentCoreRuntimePolicy --profile $Profile
aws iam delete-role --role-name EMSRelayAgentCoreRuntimeRole --profile $Profile
```

secret도 더 이상 사용하지 않을 때 7일 복구 기간으로 삭제 예약한다.

```powershell
aws secretsmanager delete-secret --secret-id ems-relay/external-api-keys `
  --recovery-window-in-days 7 --profile $Profile --region $Region
aws secretsmanager delete-secret --secret-id ems-relay/demo-users `
  --recovery-window-in-days 7 --profile $Profile --region $Region
```

### 7.6 삭제 완료 확인

```powershell
aws cloudformation describe-stacks --stack-name $Stack --profile $Profile --region $Region
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id $AgentRuntimeId `
  --profile $Profile --region $Region
aws healthlake describe-fhir-datastore --datastore-id $HealthLakeId `
  --profile $Profile --region $Region
aws resourcegroupstaggingapi get-resources `
  --tag-filters Key=Project,Values=EMSRelay `
  --profile $Profile --region $Region
```

삭제된 resource 조회는 `ResourceNotFound` 계열 오류가 정상이다. 마지막 명령 결과에 남은 EMS Relay 리소스가 있으면 비용과 보존 필요성을 각각 확인한다.

마지막으로 Amplify app을 삭제하고, Kakao Developers에서 Amplify 도메인을 제거한 뒤 사용하지 않는 Kakao key를 회전한다. Kakao 설정은 AWS CLI 정리 범위 밖이다.
