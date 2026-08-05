[CmdletBinding()]
param(
  [string]$Profile = "ems-relay-cgb",
  [string]$ExpectedAccountId = "462993243992",
  [string]$Region = "ap-northeast-2",
  [string]$StackName = "ems-relay-seoul-v2",
  [string]$AmplifyAppId = "d1b1dqlcfz85e3",
  [string]$AmplifyAppName = "",
  [string]$BranchName = "main",
  [ValidateSet("ems-relay/external-api-keys")]
  [string]$ExternalApiSecretName = "ems-relay/external-api-keys",
  [string]$ModelId = "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  [string]$ParamedicSub = "",
  [string[]]$HospitalIds = @(),
  [string[]]$HospitalNetworkIds = @(
    "A2200012", "A2200046", "A2200010", "A2200011", "A2200005",
    "A2200008", "A2200038", "A2200003", "A2200007"
  ),
  [switch]$SkipSeed,
  [switch]$ResetSeed,
  [int]$DeploymentTimeoutSeconds = 600,
  [string]$PythonCommand = "python",
  [string]$VerificationFile = ""
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""
$env:SAM_CLI_TELEMETRY = "0"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$ProductionEnvPath = Join-Path $ProjectRoot ".env.production"
$OutputsRoot = Join-Path $ProjectRoot "outputs"
$VerificationFile = if ([string]::IsNullOrWhiteSpace($VerificationFile)) {
  # Deployment metadata (schema v1) must never overwrite the browser E2E
  # cleanup gate at outputs/seoul-v2-verification.json (schema v2).
  Join-Path $OutputsRoot "seoul-v2-deployment.json"
}
else {
  [IO.Path]::GetFullPath($VerificationFile)
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is not available: $Name"
  }
}

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
    throw "AWS CLI command failed with exit code ${ExitCode}: $Details"
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

function Set-EnvironmentValues {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Values,
    [string[]]$RemoveKeys = @()
  )

  $RemoveSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($Key in $RemoveKeys) { [void]$RemoveSet.Add($Key) }
  foreach ($Key in $Values.Keys) {
    if ($RemoveSet.Contains([string]$Key)) { throw "Environment key cannot be set and removed together: $Key" }
  }

  $Lines = [Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    foreach ($Line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
      $Lines.Add([string]$Line)
    }
  }

  $Written = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
    if ($Lines[$Index] -match '^([A-Za-z_][A-Za-z0-9_]*)=') {
      $Key = $Matches[1]
      if ($RemoveSet.Contains($Key)) {
        $Lines.RemoveAt($Index)
        $Index--
        continue
      }
      if ($Values.ContainsKey($Key)) {
        $Lines[$Index] = "${Key}=$($Values[$Key])"
        [void]$Written.Add($Key)
      }
    }
  }

  foreach ($Key in $Values.Keys | Sort-Object) {
    if (-not $Written.Contains($Key)) {
      $Lines.Add("${Key}=$($Values[$Key])")
    }
  }

  $Parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null
  $TemporaryPath = Join-Path $Parent (".{0}.{1}.tmp" -f (Split-Path -Leaf $Path), [guid]::NewGuid())
  try {
    [IO.File]::WriteAllLines($TemporaryPath, $Lines, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $TemporaryPath -Destination $Path -Force
  }
  finally {
    if (Test-Path -LiteralPath $TemporaryPath) {
      Remove-Item -LiteralPath $TemporaryPath -Force
    }
  }
}

function Set-CspEndpoints {
  param(
    [Parameter(Mandatory = $true)][string]$HeaderText,
    [Parameter(Mandatory = $true)][string]$GraphQLUrl,
    [Parameter(Mandatory = $true)][string]$GraphQLRealtimeUrl,
    [Parameter(Mandatory = $true)][string]$CognitoDomain,
    [Parameter(Mandatory = $true)][string]$AwsRegion
  )

  $GraphQLOrigin = ([Uri]$GraphQLUrl).GetLeftPart([UriPartial]::Authority)
  $RealtimeOrigin = ([Uri]$GraphQLRealtimeUrl).GetLeftPart([UriPartial]::Authority)
  $CognitoOrigin = ([Uri]$CognitoDomain).GetLeftPart([UriPartial]::Authority)
  $Csp = @(
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://dapi.kakao.com https://t1.daumcdn.net https://*.daumcdn.net https://*.kakaocdn.net",
    "style-src 'self' 'unsafe-inline' https://*.daumcdn.net https://*.kakaocdn.net",
    "img-src 'self' data: blob: https://*.kakao.com https://*.daumcdn.net https://*.kakaocdn.net",
    "font-src 'self' data:",
    "connect-src 'self' $GraphQLOrigin $RealtimeOrigin wss://transcribestreaming.${AwsRegion}.amazonaws.com:8443 $CognitoOrigin https://dapi.kakao.com https://*.kakao.com https://*.daum.net https://*.daumcdn.net https://*.kakaocdn.net",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' $CognitoOrigin",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ) -join "; "

  $Pattern = '(?ms)(- key:\s*Content-Security-Policy\s*\r?\n\s*value:\s*)"[^"]*"'
  $CspMatches = [regex]::Matches($HeaderText, $Pattern)
  if ($CspMatches.Count -ne 1) { throw "Expected exactly one Content-Security-Policy header." }
  $CspRegex = [regex]::new($Pattern)
  $Evaluator = [Text.RegularExpressions.MatchEvaluator]{
    param($Match)
    return $Match.Groups[1].Value + '"' + $Csp + '"'
  }
  return $CspRegex.Replace($HeaderText, $Evaluator, 1)
}

function New-StaticArchive {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$ArchivePath
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $OutputRoot = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd([char[]]@('\', '/'))
  $IndexPath = Join-Path $OutputRoot "index.html"
  if (-not (Test-Path -LiteralPath $IndexPath -PathType Leaf)) {
    throw "Static output is missing index.html: $IndexPath"
  }

  $IndexFile = Get-Item -LiteralPath $IndexPath
  $OtherFiles = Get-ChildItem -LiteralPath $OutputRoot -File -Recurse |
    Where-Object { $_.FullName -ne $IndexFile.FullName } |
    Sort-Object FullName
  $Files = @($IndexFile) + @($OtherFiles)

  $Stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $Archive = [IO.Compression.ZipArchive]::new($Stream, [IO.Compression.ZipArchiveMode]::Create, $false, [Text.Encoding]::UTF8)
    try {
      foreach ($File in $Files) {
        $EntryName = $File.FullName.Substring($OutputRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($EntryName) -or $EntryName.StartsWith("./") -or $EntryName.StartsWith("/")) {
          throw "Invalid Amplify archive entry: $EntryName"
        }
        $Entry = $Archive.CreateEntry($EntryName, [IO.Compression.CompressionLevel]::Optimal)
        $EntryStream = $Entry.Open()
        $FileStream = [IO.File]::OpenRead($File.FullName)
        try { $FileStream.CopyTo($EntryStream) }
        finally {
          $FileStream.Dispose()
          $EntryStream.Dispose()
        }
      }
    }
    finally { $Archive.Dispose() }
  }
  finally { $Stream.Dispose() }

  $CheckArchive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $Names = @($CheckArchive.Entries | ForEach-Object FullName)
    if ($Names.Count -ne $Files.Count -or $Names[0] -ne "index.html") {
      throw "Amplify archive verification failed."
    }
    foreach ($Required in @("login/index.html", "auth/callback/index.html", "paramedic/index.html", "hospital/index.html")) {
      if ($Required -notin $Names) { throw "Amplify archive is missing: $Required" }
    }
  }
  finally { $CheckArchive.Dispose() }
}

function Wait-AmplifyJob {
  param(
    [Parameter(Mandatory = $true)][string]$AppId,
    [Parameter(Mandatory = $true)][string]$JobId
  )
  $Deadline = (Get-Date).AddSeconds($DeploymentTimeoutSeconds)
  do {
    Start-Sleep -Seconds 5
    $Job = Invoke-AwsJson @(
      "amplify", "get-job", "--app-id", $AppId, "--branch-name", $BranchName,
      "--job-id", $JobId, "--profile", $Profile, "--region", $Region, "--output", "json"
    )
    $Status = [string]$Job.job.summary.status
  } while ($Status -in @("PENDING", "PROVISIONING", "RUNNING") -and (Get-Date) -lt $Deadline)

  if ($Status -ne "SUCCEED") {
    throw "Amplify deployment did not succeed. Final status: $Status"
  }
  return $Job.job.summary
}

function Assert-HttpSuccess {
  param([Parameter(Mandatory = $true)][string]$Uri)
  $Response = Invoke-WebRequest -Uri $Uri -Method Get -UseBasicParsing -TimeoutSec 30
  if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 300) {
    throw "HTTP verification failed for $Uri with status $($Response.StatusCode)."
  }
  return $Response
}

foreach ($Command in @("aws", "sam", "npm", "node", "curl.exe")) {
  Assert-Command $Command
}
if ([string]::IsNullOrWhiteSpace($PythonCommand)) { throw "PythonCommand must not be empty." }
Assert-Command $PythonCommand

if ($Region -ne "ap-northeast-2") { throw "This script is restricted to ap-northeast-2." }
if ($StackName -ne "ems-relay-seoul-v2") { throw "Unexpected Seoul stack name: $StackName" }
if ($AmplifyAppId -ne "d1b1dqlcfz85e3") { throw "Unexpected protected Amplify app id: $AmplifyAppId" }
if ($SkipSeed -and $ResetSeed) { throw "-SkipSeed and -ResetSeed cannot be used together." }
$HospitalNetworkIds = @($HospitalNetworkIds | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
if (-not $HospitalNetworkIds.Count) { throw "At least one HospitalNetworkId is required." }
foreach ($HospitalNetworkId in $HospitalNetworkIds) {
  if ($HospitalNetworkId -notmatch '^[A-Za-z0-9_-]{2,128}$') { throw "HospitalNetworkId format is invalid." }
}
if (-not $SkipSeed) {
  $HospitalIds = @($HospitalIds | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
  if ($HospitalIds.Count -ne 3) { throw "Exactly three unique HospitalIds are required unless -SkipSeed is used." }
  foreach ($HospitalId in $HospitalIds) {
    if ($HospitalId -notmatch '^[A-Za-z0-9_-]{2,128}$') { throw "HospitalId format is invalid." }
  }
}

# Fail locally before any cloud resource or hosting configuration can be changed.
$SeedScriptPath = Join-Path $BackendRoot "scripts\seed-v2.mjs"
& node --check $SeedScriptPath
if ($LASTEXITCODE -ne 0) { throw "The v2 seed script is not valid JavaScript." }

$SamConfigRoot = Join-Path $BackendRoot ".sam-cli-config-v2"
New-Item -ItemType Directory -Force -Path $SamConfigRoot | Out-Null
$env:__SAM_CLI_APP_DIR = $SamConfigRoot
Push-Location $BackendRoot
try {
  sam validate --lint --template-file template-v2.yaml
  if ($LASTEXITCODE -ne 0) { throw "SAM template validation failed." }
  sam build --template-file template-v2.yaml --build-dir .aws-sam-v2
  if ($LASTEXITCODE -ne 0) { throw "SAM build failed." }
}
finally { Pop-Location }

$Identity = Invoke-AwsJson @("sts", "get-caller-identity", "--profile", $Profile, "--output", "json")
if ([string]$Identity.Account -ne $ExpectedAccountId -or [string]$Identity.Arn -ne "arn:aws:iam::${ExpectedAccountId}:user/CGB") {
  throw "AWS identity mismatch. Expected CGB in account $ExpectedAccountId."
}

$ModelAvailability = Invoke-AwsJson @(
  "bedrock", "get-foundation-model-availability", "--model-id", $ModelId,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
if ($ModelAvailability.authorizationStatus -ne "AUTHORIZED" -or $ModelAvailability.regionAvailability -ne "AVAILABLE") {
  throw "Bedrock model is not authorized and available in Seoul: $ModelId"
}

# The target is deliberately pinned so a similarly named app can never receive this build.
$AmplifyResult = Invoke-AwsJson @(
  "amplify", "get-app", "--app-id", $AmplifyAppId,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
$AmplifyApp = $AmplifyResult.app
if ([string]$AmplifyApp.appId -ne $AmplifyAppId) { throw "Amplify returned an unexpected app id." }
if (-not [string]::IsNullOrWhiteSpace($AmplifyAppName) -and [string]$AmplifyApp.name -ne $AmplifyAppName) {
  throw "Amplify app name mismatch for protected app $AmplifyAppId."
}
$AmplifyAppName = [string]$AmplifyApp.name
$DefaultDomain = [string]$AmplifyApp.defaultDomain
if ([string]::IsNullOrWhiteSpace($AmplifyAppId) -or [string]::IsNullOrWhiteSpace($DefaultDomain)) {
  throw "Amplify app metadata is incomplete."
}

$Branches = Invoke-AwsJson @(
  "amplify", "list-branches", "--app-id", $AmplifyAppId,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
if (-not (@($Branches.branches | Where-Object branchName -eq $BranchName))) {
  $null = Invoke-AwsJson @(
    "amplify", "create-branch", "--app-id", $AmplifyAppId, "--branch-name", $BranchName,
    "--stage", "PRODUCTION", "--no-enable-auto-build",
    "--profile", $Profile, "--region", $Region, "--output", "json"
  )
}

$FrontendBaseUrl = "https://${BranchName}.${DefaultDomain}"
$CallbackUrl = "${FrontendBaseUrl}/auth/callback"
$LogoutUrl = "${FrontendBaseUrl}/login"

# The Seoul secret is provisioned independently. Deployment must never copy
# credentials from a retired region or print their value.
$DestinationSecrets = Invoke-AwsJson @(
  "secretsmanager", "list-secrets", "--filters", "Key=name,Values=$ExternalApiSecretName",
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
$Destination = @($DestinationSecrets.SecretList | Where-Object Name -eq $ExternalApiSecretName)
if ($Destination.Count -gt 1) { throw "Multiple destination secrets matched the protected name." }
if ($Destination.Count -eq 0) {
  throw "Required Seoul external API secret is missing: $ExternalApiSecretName"
}

$DestinationSecret = Invoke-AwsJson @(
  "secretsmanager", "describe-secret", "--secret-id", $ExternalApiSecretName,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
$ExpectedDestinationPrefix = "arn:aws:secretsmanager:${Region}:${ExpectedAccountId}:secret:${ExternalApiSecretName}-"
if (-not ([string]$DestinationSecret.ARN).StartsWith($ExpectedDestinationPrefix, [StringComparison]::Ordinal)) {
  throw "Destination secret identity mismatch."
}

Push-Location $BackendRoot
try {
  $ParameterOverrides = @(
    "BedrockModelId=$ModelId",
    "CognitoCallbackUrls=$CallbackUrl",
    "CognitoLogoutUrls=$LogoutUrl",
    "ExternalApiSecretName=$ExternalApiSecretName",
    "HospitalNetworkAllowedIds=$($HospitalNetworkIds -join ',')"
  )
  $DeployArguments = @(
    "deploy", "--template-file", (Join-Path $BackendRoot ".aws-sam-v2\template.yaml"),
    "--stack-name", $StackName, "--region", $Region, "--profile", $Profile,
    "--capabilities", "CAPABILITY_IAM", "--resolve-s3",
    "--no-confirm-changeset", "--no-fail-on-empty-changeset",
    "--tags", "Project=EMS-Relay", "Environment=V2", "ManagedBy=deploy-seoul-v2.ps1",
    "--parameter-overrides"
  ) + $ParameterOverrides
  sam @DeployArguments
  if ($LASTEXITCODE -ne 0) { throw "SAM deployment failed." }
}
finally { Pop-Location }

$Stack = Invoke-AwsJson @(
  "cloudformation", "describe-stacks", "--stack-name", $StackName,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
$StackRecord = $Stack.Stacks[0]
if ([string]$StackRecord.StackStatus -notin @("CREATE_COMPLETE", "UPDATE_COMPLETE")) {
  throw "Seoul stack is not complete: $($StackRecord.StackStatus)"
}
$Outputs = @{}
foreach ($Output in $StackRecord.Outputs) { $Outputs[[string]$Output.OutputKey] = [string]$Output.OutputValue }
foreach ($RequiredOutput in @(
  "GraphQLApiId", "GraphQLUrl", "GraphQLRealtimeUrl", "UserPoolId", "UserPoolClientId",
  "CognitoDomain", "CaseTableName", "MatchingQueueUrl"
)) {
  if ([string]::IsNullOrWhiteSpace($Outputs[$RequiredOutput])) { throw "Missing stack output: $RequiredOutput" }
}

$GraphQLApi = Invoke-AwsJson @(
  "appsync", "get-graphql-api", "--api-id", $Outputs.GraphQLApiId,
  "--profile", $Profile, "--region", $Region, "--output", "json"
)
if ([string]$GraphQLApi.graphqlApi.uris.GRAPHQL -ne $Outputs.GraphQLUrl) {
  throw "AppSync GraphQL output verification failed."
}
if ([string]$GraphQLApi.graphqlApi.uris.REALTIME -ne $Outputs.GraphQLRealtimeUrl) {
  throw "AppSync realtime output verification failed."
}

if (-not $SkipSeed) {
  $GroupResult = Invoke-AwsJson @(
    "cognito-idp", "list-users-in-group", "--user-pool-id", $Outputs.UserPoolId,
    "--group-name", "paramedic", "--profile", $Profile, "--region", $Region, "--output", "json"
  )
  $GroupMembers = @($GroupResult.Users | ForEach-Object {
    $SubAttribute = $_.Attributes | Where-Object Name -eq "sub" | Select-Object -First 1
    if ($SubAttribute -and -not [string]::IsNullOrWhiteSpace([string]$SubAttribute.Value)) {
      [pscustomobject]@{ Username = [string]$_.Username; Sub = [string]$SubAttribute.Value }
    }
  })
  if ([string]::IsNullOrWhiteSpace($ParamedicSub)) {
    if ($GroupMembers.Count -ne 1) {
      throw "Provide -ParamedicSub when the paramedic group does not contain exactly one user."
    }
    $ParamedicSub = $GroupMembers[0].Sub
  }
  elseif (-not ($GroupMembers | Where-Object Sub -eq $ParamedicSub)) {
    throw "ParamedicSub is not a member of the deployed paramedic Cognito group."
  }

  $SeedCaseIds = @("GW-STROKE-001", "GW-STROKE-002", "GW-STROKE-003")
  $ExistingSeeds = @()
  foreach ($CaseId in $SeedCaseIds) {
    $KeyJson = @{ PK = @{ S = "CASE#$CaseId" }; SK = @{ S = "META" } } | ConvertTo-Json -Compress
    # Windows PowerShell 5.1 can strip the nested JSON quotes when an inline
    # object is forwarded through aws.cmd. A scoped file keeps the exact key
    # document intact without widening the deletion target.
    $KeyPath = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-seed-key-{0}-{1}.json" -f $CaseId, [guid]::NewGuid())
    try {
      [IO.File]::WriteAllText($KeyPath, $KeyJson, [Text.UTF8Encoding]::new($false))
      $Lookup = Invoke-AwsJson @(
        "dynamodb", "get-item", "--table-name", $Outputs.CaseTableName, "--key", "file://$KeyPath",
        "--consistent-read", "--profile", $Profile, "--region", $Region, "--output", "json"
      )
    }
    finally {
      if (Test-Path -LiteralPath $KeyPath) { Remove-Item -LiteralPath $KeyPath -Force }
    }
    if ($Lookup.Item) {
      $AssignedSubs = @($Lookup.Item.assignedParamedicIds.L | ForEach-Object { [string]$_.S })
      if ($ParamedicSub -notin $AssignedSubs) { throw "Existing seed assignment does not match ParamedicSub: $CaseId" }
      $ExistingSeeds += $CaseId
    }
  }
  if (-not $ResetSeed -and $ExistingSeeds.Count -notin @(0, 3)) {
    throw "Only part of the three-case seed exists. Refusing to create an inconsistent demo set."
  }
  if ($ResetSeed -or $ExistingSeeds.Count -eq 0) {
    $PreviousProfile = $env:AWS_PROFILE
    try {
      $env:AWS_PROFILE = $Profile
      $SeedArguments = @(
        (Join-Path $BackendRoot "scripts\seed-v2.mjs"),
        "--apply", "--table", $Outputs.CaseTableName,
        "--paramedic-sub", $ParamedicSub,
        "--hospital-ids", ($HospitalIds -join ","),
        "--region", $Region
      )
      if ($ResetSeed) { $SeedArguments += "--replace" }
      $SeedOutput = & node @SeedArguments 2>&1
      if ($LASTEXITCODE -ne 0) { throw "The three-case v2 seed transaction failed." }
      $SeedOutput = $null
    }
    finally { $env:AWS_PROFILE = $PreviousProfile }
  }
}

$FrontendBuildEnvironment = @{
  NEXT_PUBLIC_EMS_DATA_MODE = "remote"
  NEXT_PUBLIC_EMS_V2_GRAPHQL_URL = $Outputs.GraphQLUrl
  NEXT_PUBLIC_EMS_V2_GRAPHQL_REALTIME_URL = $Outputs.GraphQLRealtimeUrl
  NEXT_PUBLIC_EMS_ALLOW_DEVELOPMENT_FALLBACK = "false"
  NEXT_PUBLIC_EMS_SCRIPTED_PTT = "false"
  NEXT_PUBLIC_EMS_DEV_AUTH = "false"
  NEXT_PUBLIC_COGNITO_DOMAIN = $Outputs.CognitoDomain
  NEXT_PUBLIC_COGNITO_CLIENT_ID = $Outputs.UserPoolClientId
  NEXT_PUBLIC_COGNITO_REDIRECT_URI = $CallbackUrl
  NEXT_PUBLIC_COGNITO_LOGOUT_URI = $LogoutUrl
}

Set-EnvironmentValues -Path $ProductionEnvPath -Values $FrontendBuildEnvironment -RemoveKeys @(
  "NEXT_PUBLIC_EMS_API_BASE", "NEXT_PUBLIC_EMS_BACKEND_URL", "NEXT_PUBLIC_EMS_API_MODE",
  "NEXT_PUBLIC_EMS_OPERATIONAL_MODE", "NEXT_PUBLIC_EMS_ALLOW_LOCAL_FALLBACK",
  "NEXT_PUBLIC_EMS_DEFAULT_CASE_ID"
)

# Next.js loads .env.local after .env.production. Set the deployment values in
# the build process so local demo flags can never override production auth.
foreach ($BuildKey in $FrontendBuildEnvironment.Keys) {
  [Environment]::SetEnvironmentVariable([string]$BuildKey, [string]$FrontendBuildEnvironment[$BuildKey], "Process")
}

# Rebuild the existing security header template with the new regional endpoints.
$HeaderTemplatePath = Join-Path $ProjectRoot "customHttp.yml"
$HeaderText = Get-Content -LiteralPath $HeaderTemplatePath -Raw -Encoding UTF8
$HeaderText = Set-CspEndpoints -HeaderText $HeaderText `
  -GraphQLUrl $Outputs.GraphQLUrl `
  -GraphQLRealtimeUrl $Outputs.GraphQLRealtimeUrl `
  -CognitoDomain $Outputs.CognitoDomain `
  -AwsRegion $Region

$HeaderTempRoot = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-headers-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $HeaderTempRoot | Out-Null
$HeaderTempPath = Join-Path $HeaderTempRoot "customHttp.yml"
try {
  [IO.File]::WriteAllText($HeaderTempPath, $HeaderText, [Text.UTF8Encoding]::new($false))
  & $PythonCommand (Join-Path $PSScriptRoot "configure_amplify.py") `
    --app-id $AmplifyAppId --profile $Profile --region $Region --headers-file $HeaderTempPath
  if ($LASTEXITCODE -ne 0) { throw "Amplify hosting configuration failed." }
}
finally {
  if (Test-Path -LiteralPath $HeaderTempRoot) { Remove-Item -LiteralPath $HeaderTempRoot -Recurse -Force }
}

Push-Location $ProjectRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
}
finally { Pop-Location }

$ArchivePath = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-seoul-v2-{0}.zip" -f [guid]::NewGuid())
try {
  New-StaticArchive -SourceDirectory (Join-Path $ProjectRoot "out") -ArchivePath $ArchivePath
  $Deployment = Invoke-AwsJson @(
    "amplify", "create-deployment", "--app-id", $AmplifyAppId, "--branch-name", $BranchName,
    "--profile", $Profile, "--region", $Region, "--output", "json"
  )
  curl.exe --fail --silent --show-error --request PUT --header "Content-Type: application/zip" --upload-file $ArchivePath $Deployment.zipUploadUrl
  if ($LASTEXITCODE -ne 0) { throw "Amplify artifact upload failed." }
  $null = Invoke-AwsJson @(
    "amplify", "start-deployment", "--app-id", $AmplifyAppId, "--branch-name", $BranchName,
    "--job-id", ([string]$Deployment.jobId), "--profile", $Profile, "--region", $Region, "--output", "json"
  )
  $AmplifyJob = Wait-AmplifyJob -AppId $AmplifyAppId -JobId ([string]$Deployment.jobId)
}
finally {
  if (Test-Path -LiteralPath $ArchivePath) { Remove-Item -LiteralPath $ArchivePath -Force }
}

$null = Assert-HttpSuccess -Uri "${FrontendBaseUrl}/login/"
$null = Assert-HttpSuccess -Uri "${FrontendBaseUrl}/paramedic/"
$null = Assert-HttpSuccess -Uri "${FrontendBaseUrl}/hospital/"

$CognitoClient = Invoke-AwsJson @(
  "cognito-idp", "describe-user-pool-client", "--user-pool-id", $Outputs.UserPoolId,
  "--client-id", $Outputs.UserPoolClientId, "--profile", $Profile, "--region", $Region, "--output", "json"
)
if ($CallbackUrl -notin @($CognitoClient.UserPoolClient.CallbackURLs) -or $LogoutUrl -notin @($CognitoClient.UserPoolClient.LogoutURLs)) {
  throw "Cognito callback/logout verification failed."
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $VerificationFile) | Out-Null
$Gate = [ordered]@{
  schemaVersion = 1
  project = "EMS-Relay"
  verified = $true
  accountId = $ExpectedAccountId
  profile = $Profile
  region = $Region
  stackName = $StackName
  stackStatus = [string]$StackRecord.StackStatus
  amplifyAppName = $AmplifyAppName
  amplifyAppId = $AmplifyAppId
  amplifyUrl = $FrontendBaseUrl
  graphQLUrl = $Outputs.GraphQLUrl
  graphQLRealtimeUrl = $Outputs.GraphQLRealtimeUrl
  userPoolId = $Outputs.UserPoolId
  checks = [ordered]@{
    appSyncApi = $true
    loginPage = $true
    paramedicPage = $true
    hospitalPage = $true
    cognitoCallbacks = $true
    amplifyDeployment = ([string]$AmplifyJob.status -eq "SUCCEED")
  }
  verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
}
[IO.File]::WriteAllText($VerificationFile, ($Gate | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
  Status = "VERIFIED"
  Account = $ExpectedAccountId
  Region = $Region
  Stack = $StackName
  AmplifyAppId = $AmplifyAppId
  Url = $FrontendBaseUrl
  VerificationFile = $VerificationFile
}
