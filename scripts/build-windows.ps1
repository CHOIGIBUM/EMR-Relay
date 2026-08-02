$ErrorActionPreference = "Stop"
$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$parent = Split-Path $project -Parent
$folder = Split-Path $project -Leaf
$drive = $null

foreach ($candidate in @("R:", "S:", "T:", "U:")) {
  if (-not (Test-Path $candidate)) {
    $drive = $candidate
    break
  }
}

if (-not $drive) {
  throw "사용 가능한 임시 드라이브 문자를 찾지 못했습니다."
}

& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& subst.exe $drive $parent
try {
  Set-Location (Join-Path $drive $folder)
  & npm.cmd run build
  exit $LASTEXITCODE
}
finally {
  Set-Location $project
  & subst.exe $drive /D | Out-Null
}
