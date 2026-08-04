[CmdletBinding()]
param(
  [string]$Profile = "ems-relay-cgb",
  [string]$ExpectedAccountId = "462993243992",
  [string]$Region = "ap-northeast-2",
  [string]$StackName = "ems-relay-seoul-v2",
  [string]$AmplifyAppId = "d1b1dqlcfz85e3",
  [string]$AmplifyAppName = "ems-relay-seoul-v2",
  [string]$BranchName = "main",
  [string[]]$CaseIds = @("GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-003"),
  [string[]]$EvidenceFiles = @(),
  [string]$Notes = "",
  [switch]$ParamedicCognitoLogin,
  [switch]$HospitalCognitoLogin,
  [switch]$ThreeCasesLoaded,
  [switch]$ManualPatientInput,
  [switch]$HospitalYesResponse,
  [switch]$ParamedicHospitalSelection,
  [switch]$TransportStarted,
  [switch]$HospitalArrivalCompleted,
  [switch]$KakaoMapRendered,
  [switch]$ApproveEndToEndRun,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  Join-Path $ProjectRoot "outputs\seoul-v2-verification.json"
}
else { [IO.Path]::GetFullPath($OutputPath) }

function Invoke-AwsCapture {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  # Windows PowerShell turns native stderr into ErrorRecord objects. With the
  # script-wide Stop preference, even a successful AWS CLI command that emits
  # a blank stderr line can otherwise terminate before $LASTEXITCODE is read.
  $PreviousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $Captured = @(& aws @Arguments 2>&1)
    $ExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $PreviousPreference
  }

  $StandardOutput = [Collections.Generic.List[string]]::new()
  $StandardError = [Collections.Generic.List[string]]::new()
  foreach ($Item in $Captured) {
    $Line = [string]$Item
    if ($Item -is [Management.Automation.ErrorRecord]) {
      if (-not [string]::IsNullOrWhiteSpace($Line)) { $StandardError.Add($Line) }
    }
    else {
      $StandardOutput.Add($Line)
    }
  }

  if ($ExitCode -ne 0) {
    $Details = (@($StandardError) + @($StandardOutput) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($Details)) { $Details = "No diagnostic output was returned." }
    throw "AWS CLI command failed with exit code $($ExitCode): $Details"
  }

  foreach ($WarningLine in $StandardError) {
    Write-Warning "AWS CLI: $WarningLine"
  }
  return [pscustomobject]@{ Output = @($StandardOutput); ExitCode = $ExitCode }
}

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $Result = Invoke-AwsCapture -Arguments $Arguments
  $Text = ($Result.Output -join [Environment]::NewLine).Trim()
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  return $Text | ConvertFrom-Json
}

function Get-StackOutputValue {
  param(
    [Parameter(Mandatory = $true)]$Stack,
    [Parameter(Mandatory = $true)][string]$Key
  )
  $Matches = @($Stack.Outputs | Where-Object OutputKey -eq $Key)
  if ($Matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$Matches[0].OutputValue)) {
    throw "Required stack output is missing or ambiguous: $Key"
  }
  return [string]$Matches[0].OutputValue
}

function Assert-HttpSuccess {
  param([Parameter(Mandatory = $true)][string]$Uri)
  $Response = Invoke-WebRequest -Uri $Uri -Method Get -UseBasicParsing -TimeoutSec 30
  if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 300) {
    throw "Verification request failed: $Uri ($($Response.StatusCode))"
  }
}

if (-not $ApproveEndToEndRun) {
  throw "-ApproveEndToEndRun is required after a real browser end-to-end run."
}

$Checks = [ordered]@{
  paramedicCognitoLogin = [bool]$ParamedicCognitoLogin
  hospitalCognitoLogin = [bool]$HospitalCognitoLogin
  threeCasesLoaded = [bool]$ThreeCasesLoaded
  manualPatientInput = [bool]$ManualPatientInput
  hospitalYesResponse = [bool]$HospitalYesResponse
  paramedicHospitalSelection = [bool]$ParamedicHospitalSelection
  transportStarted = [bool]$TransportStarted
  hospitalArrivalCompleted = [bool]$HospitalArrivalCompleted
  kakaoMapRendered = [bool]$KakaoMapRendered
}
foreach ($Check in $Checks.GetEnumerator()) {
  if ($Check.Value -ne $true) { throw "End-to-end check was not explicitly approved: $($Check.Key)" }
}

$DistinctCaseIds = @($CaseIds | ForEach-Object { ([string]$_).Trim() } |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
if ($DistinctCaseIds.Count -ne 3) {
  throw "Exactly three distinct case IDs are required."
}

$ResolvedEvidenceFiles = @()
foreach ($EvidenceFile in $EvidenceFiles) {
  $Resolved = (Resolve-Path -LiteralPath $EvidenceFile -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $Resolved -PathType Leaf)) {
    throw "Evidence file is not a regular file: $Resolved"
  }
  $ResolvedEvidenceFiles += $Resolved
}

$Identity = Invoke-AwsJson @("sts", "get-caller-identity", "--profile", $Profile, "--output", "json")
if ([string]$Identity.Account -ne $ExpectedAccountId -or
    [string]$Identity.Arn -ne "arn:aws:iam::${ExpectedAccountId}:user/CGB") {
  throw "AWS identity mismatch. Verification is restricted to CGB in account $ExpectedAccountId."
}

$StackResult = Invoke-AwsJson @(
  "cloudformation", "describe-stacks", "--stack-name", $StackName,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
$Stack = $StackResult.Stacks[0]
if ([string]$Stack.StackStatus -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) {
  throw "Seoul stack is not ready: $($Stack.StackStatus)"
}

$GraphQLApiId = Get-StackOutputValue -Stack $Stack -Key "GraphQLApiId"
$GraphQLUrl = Get-StackOutputValue -Stack $Stack -Key "GraphQLUrl"
$GraphQLRealtimeUrl = Get-StackOutputValue -Stack $Stack -Key "GraphQLRealtimeUrl"
$UserPoolId = Get-StackOutputValue -Stack $Stack -Key "UserPoolId"
$UserPoolClientId = Get-StackOutputValue -Stack $Stack -Key "UserPoolClientId"
$CaseTableName = Get-StackOutputValue -Stack $Stack -Key "CaseTableName"

$AppResult = Invoke-AwsJson @(
  "amplify", "get-app", "--app-id", $AmplifyAppId,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
if ([string]$AppResult.app.name -ne $AmplifyAppName) { throw "Amplify app identity mismatch." }
$AmplifyUrl = "https://${BranchName}.$([string]$AppResult.app.defaultDomain)"

$BranchResult = Invoke-AwsJson @(
  "amplify", "get-branch", "--app-id", $AmplifyAppId, "--branch-name", $BranchName,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
if ([string]$BranchResult.branch.stage -ne "PRODUCTION") { throw "Amplify branch is not PRODUCTION." }

$Jobs = Invoke-AwsJson @(
  "amplify", "list-jobs", "--app-id", $AmplifyAppId, "--branch-name", $BranchName,
  "--max-items", "1", "--profile", $Profile, "--region", $Region, "--output", "json"
)
if (@($Jobs.jobSummaries).Count -ne 1 -or [string]$Jobs.jobSummaries[0].status -ne "SUCCEED") {
  throw "Latest Amplify deployment is not successful."
}
$AmplifyJob = $Jobs.jobSummaries[0]

$KeyFileRoot = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-verification-keys-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $KeyFileRoot | Out-Null
try {
  for ($CaseIndex = 0; $CaseIndex -lt $DistinctCaseIds.Count; $CaseIndex++) {
    $CaseId = $DistinctCaseIds[$CaseIndex]
    $KeyPath = Join-Path $KeyFileRoot ("case-key-{0}.json" -f $CaseIndex)
    $Key = @{ PK = @{ S = "CASE#$CaseId" }; SK = @{ S = "META" } } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($KeyPath, $Key, [Text.UTF8Encoding]::new($false))
    $KeyUri = "file://$(([IO.Path]::GetFullPath($KeyPath)).Replace('\', '/'))"
    $Case = Invoke-AwsJson @(
      "dynamodb", "get-item", "--table-name", $CaseTableName, "--key", $KeyUri,
      "--consistent-read", "--profile", $Profile, "--region", $Region, "--output", "json"
    )
    if ($null -eq $Case.Item) { throw "Verified case is missing from the deployed table: $CaseId" }
  }
}
finally {
  if (Test-Path -LiteralPath $KeyFileRoot) { Remove-Item -LiteralPath $KeyFileRoot -Recurse -Force }
}

Assert-HttpSuccess -Uri "${AmplifyUrl}/login/"
Assert-HttpSuccess -Uri "${AmplifyUrl}/paramedic/"
Assert-HttpSuccess -Uri "${AmplifyUrl}/hospital/"

$Gate = [ordered]@{
  schemaVersion = 2
  project = "EMS-Relay"
  verified = $true
  accountId = $ExpectedAccountId
  profile = $Profile
  region = $Region
  stackName = $StackName
  stackStatus = [string]$Stack.StackStatus
  amplifyAppName = $AmplifyAppName
  amplifyAppId = $AmplifyAppId
  amplifyUrl = $AmplifyUrl
  amplifyJobId = [string]$AmplifyJob.jobId
  amplifyJobEndTime = ([datetimeoffset]$AmplifyJob.endTime).ToUniversalTime().ToString("o")
  graphQLApiId = $GraphQLApiId
  graphQLUrl = $GraphQLUrl
  graphQLRealtimeUrl = $GraphQLRealtimeUrl
  userPoolId = $UserPoolId
  userPoolClientId = $UserPoolClientId
  checks = $Checks
  evidence = [ordered]@{
    source = "browser-end-to-end"
    caseIds = $DistinctCaseIds
    files = $ResolvedEvidenceFiles
    notes = $Notes
  }
  verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
[IO.File]::WriteAllText($OutputPath, ($Gate | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
  Status = "E2E_GATE_WRITTEN"
  OutputPath = $OutputPath
  CaseIds = ($DistinctCaseIds -join ", ")
  VerifiedAt = $Gate.verifiedAt
}
