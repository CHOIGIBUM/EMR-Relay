[CmdletBinding()]
param(
  [string]$StackName = "ems-relay-backend",
  [string]$Region = "ap-northeast-2",
  [string]$Profile = "ems-relay-cgb",
  [string]$ExpectedAccountId = "462993243992",
  [Parameter(Mandatory = $true)]
  [string]$ModelId,
  [string]$CorsOrigins = "http://localhost:3000",
  [string]$ArtifactBucket = ""
)

$ErrorActionPreference = "Stop"
$env:SAM_CLI_TELEMETRY = "0"
$BackendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SamCliConfigDir = Join-Path $BackendRoot ".sam-cli-config"
New-Item -ItemType Directory -Force -Path $SamCliConfigDir | Out-Null
$env:__SAM_CLI_APP_DIR = $SamCliConfigDir

Push-Location $BackendRoot
try {
  if ([string]::IsNullOrWhiteSpace($ExpectedAccountId)) {
    throw "ExpectedAccountId is required so deployment cannot target an unverified AWS account."
  }
  $IdentityArguments = @(
    "sts", "get-caller-identity",
    "--query", "Account",
    "--output", "text"
  )
  if ($Profile) {
    $IdentityArguments += @("--profile", $Profile)
  }
  $ActualAccountId = (aws @IdentityArguments).Trim()
  if ($LASTEXITCODE -ne 0) { throw "AWS identity verification failed." }
  if ($ActualAccountId -ne $ExpectedAccountId) {
    throw "AWS account mismatch. Expected $ExpectedAccountId but resolved $ActualAccountId."
  }

  sam validate --lint --template-file template.yaml
  if ($LASTEXITCODE -ne 0) { throw "SAM template validation failed." }
  sam build --template-file template.yaml
  if ($LASTEXITCODE -ne 0) { throw "SAM build failed." }

  $DeployArguments = @(
    "deploy",
    "--stack-name", $StackName,
    "--region", $Region,
    "--capabilities", "CAPABILITY_IAM",
    "--no-confirm-changeset",
    "--no-fail-on-empty-changeset",
    "--parameter-overrides",
    "BedrockModelId=$ModelId",
    "BedrockRegion=$Region",
    "CorsOrigins=$CorsOrigins"
  )
  if ($ArtifactBucket) {
    $DeployArguments += @("--s3-bucket", $ArtifactBucket)
  }
  else {
    $DeployArguments += "--resolve-s3"
  }
  if ($Profile) {
    $DeployArguments += @("--profile", $Profile)
  }
  sam @DeployArguments
  if ($LASTEXITCODE -ne 0) { throw "SAM deployment failed." }
}
finally {
  Pop-Location
}
