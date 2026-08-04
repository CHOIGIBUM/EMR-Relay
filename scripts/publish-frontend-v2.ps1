[CmdletBinding()]
param(
  [string]$Profile = "ems-relay-cgb",
  [string]$Region = "ap-northeast-2",
  [string]$AmplifyAppId = "d1b1dqlcfz85e3",
  [string]$BranchName = "main",
  [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ProductionEnv = Join-Path $ProjectRoot ".env.production"
$OutputRoot = Join-Path $ProjectRoot "out"

if (-not (Test-Path -LiteralPath $ProductionEnv -PathType Leaf)) {
  throw "Missing production environment file: $ProductionEnv"
}

# Process variables take precedence over .env.local during `next build`.
foreach ($Line in (Get-Content -LiteralPath $ProductionEnv -Encoding UTF8)) {
  if ($Line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
  }
}

Push-Location $ProjectRoot
try {
  npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw "Frontend typecheck failed." }
  npm.cmd run lint
  if ($LASTEXITCODE -ne 0) { throw "Frontend lint failed." }
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
}
finally { Pop-Location }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ArchivePath = Join-Path ([IO.Path]::GetTempPath()) ("ems-relay-v2-frontend-{0}.zip" -f [guid]::NewGuid())

try {
  $Root = [IO.Path]::GetFullPath($OutputRoot).TrimEnd([char[]]@('\', '/'))
  $Index = Get-Item -LiteralPath (Join-Path $Root "index.html")
  $Files = @($Index) + @(Get-ChildItem -LiteralPath $Root -File -Recurse |
    Where-Object FullName -ne $Index.FullName | Sort-Object FullName)

  $Stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $Archive = [IO.Compression.ZipArchive]::new($Stream, [IO.Compression.ZipArchiveMode]::Create, $false, [Text.Encoding]::UTF8)
    try {
      foreach ($File in $Files) {
        $Name = $File.FullName.Substring($Root.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $Entry = $Archive.CreateEntry($Name, [IO.Compression.CompressionLevel]::Optimal)
        $EntryStream = $Entry.Open()
        $FileStream = [IO.File]::OpenRead($File.FullName)
        try { $FileStream.CopyTo($EntryStream) }
        finally { $FileStream.Dispose(); $EntryStream.Dispose() }
      }
    }
    finally { $Archive.Dispose() }
  }
  finally { $Stream.Dispose() }

  $Deployment = (aws amplify create-deployment --app-id $AmplifyAppId --branch-name $BranchName `
    --profile $Profile --region $Region --output json | ConvertFrom-Json)
  if (-not $Deployment.jobId -or -not $Deployment.zipUploadUrl) { throw "Amplify did not return a deployment job." }

  curl.exe --fail --silent --show-error --request PUT --header "Content-Type: application/zip" `
    --upload-file $ArchivePath $Deployment.zipUploadUrl
  if ($LASTEXITCODE -ne 0) { throw "Amplify artifact upload failed." }

  aws amplify start-deployment --app-id $AmplifyAppId --branch-name $BranchName --job-id $Deployment.jobId `
    --profile $Profile --region $Region --output json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Amplify deployment start failed." }

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 5
    $Job = (aws amplify get-job --app-id $AmplifyAppId --branch-name $BranchName --job-id $Deployment.jobId `
      --profile $Profile --region $Region --output json | ConvertFrom-Json).job.summary
    if ((Get-Date) -gt $Deadline) { throw "Amplify deployment timed out." }
  } while ($Job.status -in @("PENDING", "PROVISIONING", "RUNNING"))

  if ($Job.status -ne "SUCCEED") { throw "Amplify deployment failed: $($Job.status)" }
  [pscustomobject]@{
    Status = $Job.status
    JobId = [string]$Deployment.jobId
    Url = "https://${BranchName}.d1b1dqlcfz85e3.amplifyapp.com"
  }
}
finally {
  if (Test-Path -LiteralPath $ArchivePath) { Remove-Item -LiteralPath $ArchivePath -Force }
}
