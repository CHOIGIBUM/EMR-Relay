[CmdletBinding()]
param(
  [string]$AppId = "d2edch3bt6kxej",
  [string]$BranchName = "main",
  [string]$Region = "us-west-2",
  [string]$Profile = "ems-relay-cgb",
  [string]$ExpectedAccountId = "462993243992",
  [string]$OutputDirectory = "",
  [switch]$SkipBuild,
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ResolvedOutputDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $ProjectRoot "out"
}
else {
  (Resolve-Path $OutputDirectory).Path
}

$ActualAccountId = (aws sts get-caller-identity `
  --profile $Profile `
  --query Account `
  --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualAccountId -ne $ExpectedAccountId) {
  throw "AWS account verification failed. Expected $ExpectedAccountId but resolved $ActualAccountId."
}

$DefaultDomain = (aws amplify get-app `
  --app-id $AppId `
  --profile $Profile `
  --region $Region `
  --query "app.defaultDomain" `
  --output text).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($DefaultDomain)) {
  throw "Amplify app verification failed."
}

if (-not $SkipBuild) {
  $ProductionEnvironmentFile = Join-Path $ProjectRoot ".env.production"
  if (-not (Test-Path -LiteralPath $ProductionEnvironmentFile -PathType Leaf)) {
    throw ".env.production is required for a production deployment."
  }
  foreach ($Line in Get-Content -LiteralPath $ProductionEnvironmentFile -Encoding UTF8) {
    $TrimmedLine = $Line.Trim()
    if (-not $TrimmedLine -or $TrimmedLine.StartsWith("#")) { continue }
    $Parts = $TrimmedLine.Split("=", 2)
    if ($Parts.Count -ne 2 -or $Parts[0] -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Invalid .env.production entry."
    }
    Set-Item -LiteralPath ("Env:{0}" -f $Parts[0]) -Value $Parts[1]
  }
  Push-Location $ProjectRoot
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Production frontend build failed." }
  }
  finally {
    Pop-Location
  }
}

$CustomHeadersPath = Join-Path $ProjectRoot "customHttp.yml"
if (Test-Path -LiteralPath $CustomHeadersPath -PathType Leaf) {
  $AgentCorePython = Join-Path $ProjectRoot "agentcore\.venv\Scripts\python.exe"
  $PythonExecutable = if (Test-Path -LiteralPath $AgentCorePython -PathType Leaf) { $AgentCorePython } else { "python" }
  & $PythonExecutable (Join-Path $PSScriptRoot "configure_amplify.py") `
    --app-id $AppId `
    --profile $Profile `
    --region $Region `
    --headers-file $CustomHeadersPath
  if ($LASTEXITCODE -ne 0) { throw "Amplify custom header update failed." }
}

$IndexPath = Join-Path $ResolvedOutputDirectory "index.html"
if (-not (Test-Path -LiteralPath $IndexPath -PathType Leaf)) {
  throw "Static output is missing. Run npm run build before deploying."
}

$TemporaryArchive = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-amplify-{0}.zip" -f [guid]::NewGuid())
try {
  # Amplify manual deployments require portable entry names with neither
  # Windows separators nor a leading "./". Build each ZIP entry explicitly so
  # clean routes and `_next/static` assets are published at the expected paths.
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $OutputRoot = [IO.Path]::GetFullPath($ResolvedOutputDirectory).TrimEnd([char[]]@('\', '/'))
  $IndexFile = Get-Item -LiteralPath $IndexPath
  $OtherFiles = Get-ChildItem -LiteralPath $OutputRoot -File -Recurse |
    Where-Object { $_.FullName -ne $IndexFile.FullName } |
    Sort-Object FullName
  $FilesToArchive = @($IndexFile) + @($OtherFiles)

  $ArchiveStream = [IO.File]::Open($TemporaryArchive, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $Archive = New-Object IO.Compression.ZipArchive(
      $ArchiveStream,
      [IO.Compression.ZipArchiveMode]::Create,
      $false,
      [Text.Encoding]::UTF8
    )
    try {
      foreach ($File in $FilesToArchive) {
        $EntryName = $File.FullName.Substring($OutputRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($EntryName) -or $EntryName.StartsWith('./') -or $EntryName.Contains('\')) {
          throw "Invalid Amplify ZIP entry name: $EntryName"
        }

        $Entry = $Archive.CreateEntry($EntryName, [IO.Compression.CompressionLevel]::Optimal)
        $EntryStream = $Entry.Open()
        $FileStream = [IO.File]::OpenRead($File.FullName)
        try {
          $FileStream.CopyTo($EntryStream)
        }
        finally {
          $FileStream.Dispose()
          $EntryStream.Dispose()
        }
      }
    }
    finally {
      $Archive.Dispose()
    }
  }
  finally {
    $ArchiveStream.Dispose()
  }

  $VerificationArchive = [IO.Compression.ZipFile]::OpenRead($TemporaryArchive)
  try {
    $EntryNames = @($VerificationArchive.Entries | ForEach-Object { $_.FullName })
    if ($EntryNames.Count -ne $FilesToArchive.Count) {
      throw "Amplify ZIP verification failed: file count mismatch."
    }
    if ($EntryNames[0] -ne 'index.html') {
      throw "Amplify ZIP verification failed: the first entry must be index.html."
    }
    if ($EntryNames | Where-Object { $_.StartsWith('./') -or $_.Contains('\') -or $_.StartsWith('/') }) {
      throw "Amplify ZIP verification failed: non-portable entry path detected."
    }
    foreach ($RequiredEntry in @('_next/static/', 'paramedic/index.html', 'control/index.html', 'hospital/index.html')) {
      $Found = if ($RequiredEntry.EndsWith('/')) {
        $EntryNames | Where-Object { $_.StartsWith($RequiredEntry) } | Select-Object -First 1
      }
      else {
        $EntryNames | Where-Object { $_ -eq $RequiredEntry } | Select-Object -First 1
      }
      if (-not $Found) {
        throw "Amplify ZIP verification failed: required entry missing: $RequiredEntry"
      }
    }
  }
  finally {
    $VerificationArchive.Dispose()
  }

  $Deployment = aws amplify create-deployment `
    --app-id $AppId `
    --branch-name $BranchName `
    --profile $Profile `
    --region $Region `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$Deployment.jobId)) {
    throw "Amplify deployment session creation failed."
  }

  curl.exe `
    --fail `
    --silent `
    --show-error `
    --request PUT `
    --header "Content-Type: application/zip" `
    --upload-file $TemporaryArchive `
    $Deployment.zipUploadUrl
  if ($LASTEXITCODE -ne 0) { throw "Amplify artifact upload failed." }

  aws amplify start-deployment `
    --app-id $AppId `
    --branch-name $BranchName `
    --job-id $Deployment.jobId `
    --profile $Profile `
    --region $Region `
    --output json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Amplify deployment start failed." }

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 5
    $Job = aws amplify get-job `
      --app-id $AppId `
      --branch-name $BranchName `
      --job-id $Deployment.jobId `
      --profile $Profile `
      --region $Region `
      --query "job.summary.{status:status,endTime:endTime}" `
      --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "Amplify deployment status lookup failed." }
  } while ($Job.status -in @("PENDING", "PROVISIONING", "RUNNING") -and (Get-Date) -lt $Deadline)

  if ($Job.status -ne "SUCCEED") {
    throw "Amplify deployment did not succeed. Final status: $($Job.status)"
  }

  [pscustomobject]@{
    Status = $Job.status
    Url = "https://$BranchName.$DefaultDomain"
    FinishedAt = $Job.endTime
  }
}
finally {
  $ExpectedTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $ResolvedArchivePath = [IO.Path]::GetFullPath($TemporaryArchive)
  if ($ResolvedArchivePath.StartsWith($ExpectedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedArchivePath)) {
    Remove-Item -LiteralPath $ResolvedArchivePath -Force
  }
}
