param(
  [string]$Profile = "ems-relay-cgb",
  [string]$Region = "us-west-2",
  [string]$StackName = "ems-relay-backend",
  [string]$CaseId = "GW-CARDIO-050",
  [switch]$Apply,
  [switch]$RealtimeProbe,
  [switch]$DirectoryProbe,
  [switch]$PrepareInteractiveCase,
  [switch]$AgentProbe,
  [switch]$TranscribeProbe
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-IsoTimestamp {
  param([DateTimeOffset]$Value = [DateTimeOffset]::UtcNow)
  return $Value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
}

if (-not $Apply) {
  throw "This script changes the deployed demo environment. Re-run with -Apply."
}
if ($PrepareInteractiveCase -or $AgentProbe -or $TranscribeProbe) {
  if ($CaseId -notmatch '^GW-CARDIO-05[1-9]$') {
    throw "Interactive cloud cases must use an isolated GW-CARDIO-051 through GW-CARDIO-059 identifier."
  }
} elseif ($CaseId -ne "GW-CARDIO-050") {
  throw "The completed cloud seed is intentionally scoped to GW-CARDIO-050."
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $raw = & aws @Arguments --profile $Profile --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI call failed: aws $($Arguments[0]) ..." }
  if ([string]::IsNullOrWhiteSpace(($raw -join "`n"))) { return $null }
  return (($raw -join "`n") | ConvertFrom-Json)
}

$stack = Invoke-AwsJson @("cloudformation", "describe-stacks", "--stack-name", $StackName)
$outputs = @{}
foreach ($entry in $stack.Stacks[0].Outputs) { $outputs[$entry.OutputKey] = $entry.OutputValue }
$functionName = [string]$outputs.FunctionName
$tableName = [string]$outputs.CaseTableName
$userPoolId = [string]$outputs.UserPoolId
$reportBucket = [string]$outputs.ReportBucketName

if (-not $functionName -or -not $tableName -or -not $userPoolId -or -not $reportBucket) {
  throw "Required CloudFormation outputs are missing."
}

$users = (Invoke-AwsJson @("cognito-idp", "list-users", "--user-pool-id", $userPoolId)).Users
function Find-DemoUser {
  param([Parameter(Mandatory)][string]$Email)
  $user = $users | Where-Object {
    ($_.Attributes | Where-Object Name -eq "email" | Select-Object -First 1).Value -eq $Email
  } | Select-Object -First 1
  if (-not $user) { throw "Cognito demo user is missing: $Email" }
  $sub = ($user.Attributes | Where-Object Name -eq "sub" | Select-Object -First 1).Value
  return [pscustomobject]@{ Username = [string]$user.Username; Sub = [string]$sub; Email = $Email }
}

$control = Find-DemoUser "control.demo@emsrelay.kr"
$paramedic = Find-DemoUser "paramedic.demo@emsrelay.kr"
$hospital = Find-DemoUser "hospital.demo@emsrelay.kr"

function Invoke-BackendRoute {
  param(
    [Parameter(Mandatory)][ValidateSet("GET", "POST")][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][ValidateSet("control", "paramedic", "hospital", "admin")][string]$Role,
    [Parameter(Mandatory)][string]$Sub,
    [hashtable]$Query,
    [object]$Body,
    [string]$HospitalId,
    [switch]$AllowError
  )
  $claims = [ordered]@{
    sub = $Sub
    "cognito:groups" = "[$Role]"
    "cognito:username" = "$Role.demo@emsrelay.kr"
  }
  if ($HospitalId) { $claims["custom:hospital_id"] = $HospitalId }

  $event = [ordered]@{
    version = "2.0"
    routeKey = "$Method $Path"
    rawPath = $Path
    rawQueryString = ""
    headers = @{ "content-type" = "application/json" }
    requestContext = [ordered]@{
      authorizer = @{ jwt = @{ claims = $claims; scopes = @() } }
      http = @{ method = $Method; path = $Path; protocol = "HTTP/1.1"; sourceIp = "127.0.0.1"; userAgent = "ems-relay-cloud-e2e-seed" }
      requestId = "seed-$([guid]::NewGuid().ToString('N'))"
      routeKey = "$Method $Path"
      stage = '$default'
      timeEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    isBase64Encoded = $false
  }
  if ($Path -match '^/cases/([^/]+)') { $event.pathParameters = @{ id = $Matches[1] } }
  if ($Query) {
    $event.queryStringParameters = $Query
    $event.rawQueryString = (($Query.GetEnumerator() | ForEach-Object { "{0}={1}" -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value) }) -join "&")
  }
  if ($null -ne $Body) { $event.body = ($Body | ConvertTo-Json -Compress -Depth 30) }

  $json = $event | ConvertTo-Json -Compress -Depth 40
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  $temp = Join-Path ([IO.Path]::GetTempPath()) "ems-relay-$([guid]::NewGuid().ToString('N')).json"
  try {
    $null = & aws lambda invoke --function-name $functionName --payload $payload --cli-binary-format base64 --profile $Profile --region $Region --output json $temp
    if ($LASTEXITCODE -ne 0) { throw "Lambda invoke failed for $Method $Path" }
    $proxy = Get-Content -Raw -Encoding UTF8 -LiteralPath $temp | ConvertFrom-Json
    if (-not $proxy.PSObject.Properties["statusCode"]) {
      throw "Lambda returned an unhandled error for $Method $Path."
    }
    $parsedBody = if ($proxy.body) { $proxy.body | ConvertFrom-Json } else { $null }
    if ([int]$proxy.statusCode -ge 400 -and -not $AllowError) {
      $message = if ($parsedBody -and $parsedBody.PSObject.Properties["message"]) {
        [string]$parsedBody.message
      } elseif ($parsedBody -and $parsedBody.PSObject.Properties["error"] -and $parsedBody.error.PSObject.Properties["message"]) {
        [string]$parsedBody.error.message
      } else {
        "HTTP $($proxy.statusCode)"
      }
      if ($parsedBody -and $parsedBody.PSObject.Properties["issues"]) {
        $message += ": " + (@($parsedBody.issues) -join "; ")
      } elseif ($parsedBody -and $parsedBody.PSObject.Properties["error"] -and $parsedBody.error.PSObject.Properties["details"]) {
        $message += ": " + (@($parsedBody.error.details) -join "; ")
      }
      throw "$Method $Path failed: $message"
    }
    return [pscustomobject]@{ StatusCode = [int]$proxy.statusCode; Body = $parsedBody }
  } finally {
    if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
  }
}

function Get-CaseView {
  return (Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role paramedic -Sub $paramedic.Sub).Body
}

function Ensure-Command {
  param(
    [Parameter(Mandatory)][string]$Type,
    [Parameter(Mandatory)][hashtable]$Payload,
    [Parameter(Mandatory)][ValidateSet("control", "paramedic", "hospital")][string]$Role,
    [Parameter(Mandatory)][string]$Sub,
    [string]$HospitalId
  )
  $view = Get-CaseView
  if ($view.events.type -contains $Type) { return $view }
  $body = [ordered]@{
    commandId = "seed-$($Type.ToLowerInvariant().Replace('_','-'))"
    type = $Type
    expectedVersion = [int]$view.meta.version
    payload = $Payload
  }
  $invoke = @{ Method = "POST"; Path = "/cases/$CaseId/commands"; Role = $Role; Sub = $Sub; Body = $body }
  if ($HospitalId) { $invoke.HospitalId = $HospitalId }
  $null = Invoke-BackendRoute @invoke
  return Get-CaseView
}

if ($AgentProbe) {
  $before = Get-CaseView
  $agentResult = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/voice-updates/proposals" -Role paramedic -Sub $paramedic.Sub -Body ([ordered]@{
    caseId = $CaseId
    updateId = "agentcore-cloud-probe"
    clientEventId = "agentcore-cloud-probe-$([guid]::NewGuid().ToString('N'))"
    locale = "ko-KR"
    transcript = "환자 접촉했습니다. 흉통은 8점이고 호흡곤란이 있습니다. 혈압 172에 96, 맥박 104, 호흡수 24, 산소포화도 93퍼센트입니다."
  })
  $after = Get-CaseView
  if ($agentResult.StatusCode -ne 201 -or -not $agentResult.Body.pending_review) { throw "AgentCore proposal probe failed." }
  if ([int]$after.confirmedState.version -ne [int]$before.confirmedState.version) { throw "AgentCore proposal was incorrectly written as confirmed data." }
  [ordered]@{
    caseId = $CaseId
    statusCode = $agentResult.StatusCode
    pendingReview = [bool]$agentResult.Body.pending_review
    proposalCount = @($agentResult.Body.proposed_updates).Count
    warningCount = @($agentResult.Body.warnings).Count
    confirmedVersionBefore = $before.confirmedState.version
    confirmedVersionAfter = $after.confirmedState.version
  } | ConvertTo-Json -Depth 6
  return
}

if ($TranscribeProbe) {
  $session = Invoke-BackendRoute -Method POST -Path "/transcribe/session" -Role paramedic -Sub $paramedic.Sub -Body ([ordered]@{
    caseId = $CaseId
    languageCode = "ko-KR"
    sampleRateHertz = 16000
  })
  $uri = [uri][string]$session.Body.websocketUrl
  if ($session.StatusCode -ne 201 -or $uri.Scheme -ne "wss" -or $uri.Host -notlike "transcribestreaming.*.amazonaws.com") {
    throw "Amazon Transcribe streaming session probe failed."
  }
  [ordered]@{
    caseId = $CaseId
    statusCode = $session.StatusCode
    protocol = $uri.Scheme
    host = $uri.Host
    languageCode = $session.Body.languageCode
    mediaEncoding = $session.Body.mediaEncoding
    sampleRateHertz = $session.Body.sampleRateHertz
    expiresAt = $session.Body.expiresAt
    rawAudioStored = $false
  } | ConvertTo-Json -Depth 5
  return
}

if ($PrepareInteractiveCase) {
  $sokchoMedicalCenterId = "A2200012"
  $null = & aws cognito-idp admin-update-user-attributes --user-pool-id $userPoolId --username $hospital.Username --user-attributes "Name=custom:hospital_id,Value=$sokchoMedicalCenterId" --profile $Profile --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Unable to bind the hospital demo user to the NMC institution." }

  $probe = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role control -Sub $control.Sub -AllowError
  if ($probe.StatusCode -eq 404) {
    $assign = [ordered]@{
      commandId = "prepare-interactive-case-assigned"
      type = "CASE_ASSIGNED"
      expectedVersion = 0
      payload = [ordered]@{
        assignedParamedicIds = @($paramedic.Sub)
        scenario = "65-74세 추정 여성 · 흉통·호흡곤란 · 속초관광수산시장"
        agency = "강원특별자치도 소방본부"
        unitId = "영랑119안전센터 구급대"
        vehicleNumber = "강원12가1190"
        reportedAt = (Get-IsoTimestamp)
        dispatchSummary = "65-74세 추정 여성, 흉통과 호흡곤란"
        estimatedAgeBand = "65-74"
        estimatedSex = "여성 추정"
        unitBase = @{ name = "영랑119안전센터"; address = "강원특별자치도 속초시 번영로 188"; latitude = 38.2154164233856; longitude = 128.59031570815 }
        reportedPlaceName = "속초관광수산시장"
        reportedAddress = "강원특별자치도 속초시 중앙로147번길 16"
        reportedLocation = @{ latitude = 38.204542733975174; longitude = 128.5902457350099 }
        source = "synthetic_119_dispatch"
      }
    }
    $null = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/commands" -Role control -Sub $control.Sub -Body $assign
  } elseif ($probe.StatusCode -ne 200) {
    throw "Unable to probe the interactive demo case."
  }

  $controlRead = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role control -Sub $control.Sub
  $paramedicRead = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role paramedic -Sub $paramedic.Sub
  $hospitalRead = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role hospital -Sub $hospital.Sub -HospitalId $sokchoMedicalCenterId -AllowError
  $view = $paramedicRead.Body
  $destinationHospitalId = if ($view.meta.PSObject.Properties["destinationHospitalId"]) { [string]$view.meta.destinationHospitalId } else { "" }

  $unexpectedEvents = @($view.events | Where-Object type -ne "CASE_ASSIGNED")
  if ($view.meta.stage -ne "ASSIGNED" -or [int]$view.meta.version -ne 1) { throw "Interactive case is not at ASSIGNED version 1." }
  if ([int]$view.confirmedState.version -ne 0 -or @($view.confirmedState.facts.PSObject.Properties).Count -ne 0) { throw "Interactive case unexpectedly contains clinical facts." }
  if (@($view.hospitalRequests).Count -ne 0 -or $destinationHospitalId) { throw "Interactive case unexpectedly contains a hospital selection." }
  if ($unexpectedEvents.Count -ne 0) { throw "Interactive case contains workflow events beyond assignment." }
  if ($controlRead.StatusCode -ne 200 -or $paramedicRead.StatusCode -ne 200 -or $hospitalRead.StatusCode -ne 403) {
    throw "Role-filtered read verification failed."
  }

  [ordered]@{
    caseId = $CaseId
    stage = $view.meta.stage
    workflowVersion = $view.meta.version
    eventTypes = @($view.events.type)
    confirmedStateVersion = $view.confirmedState.version
    confirmedFactCount = @($view.confirmedState.facts.PSObject.Properties).Count
    hospitalRequestCount = @($view.hospitalRequests).Count
    destinationHospitalSelected = [bool]$destinationHospitalId
    readAccess = @{ control = $controlRead.StatusCode; assignedParamedic = $paramedicRead.StatusCode; unrequestedHospital = $hospitalRead.StatusCode }
    hospitalDemoBinding = @{ hospitalId = $sokchoMedicalCenterId; displayName = "강원특별자치도속초의료원" }
  } | ConvertTo-Json -Depth 8
  return
}

if ($RealtimeProbe) {
  $session = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/realtime-session" -Role paramedic -Sub $paramedic.Sub -Body @{}
  $env:EMS_RELAY_WS_PROBE_URL = [string]$session.Body.websocketUrl
  try {
    $probeScript = (Resolve-Path "backend/scripts/websocket-probe.mjs").Path
    $probe = & node $probeScript
    if ($LASTEXITCODE -ne 0) { throw "WebSocket handshake probe failed." }
    $probe
    return
  } finally {
    Remove-Item Env:EMS_RELAY_WS_PROBE_URL -ErrorAction SilentlyContinue
  }
}

if ($DirectoryProbe) {
  $directoryResult = (Invoke-BackendRoute -Method GET -Path "/hospitals" -Role paramedic -Sub $paramedic.Sub -Query @{ case_id = $CaseId; lat = "38.2070"; lng = "128.5918" }).Body
  [ordered]@{
    source = $directoryResult.source
    referenceAt = $directoryResult.reference_at
    hospitals = @($directoryResult.hospitals | Select-Object -First 8 | ForEach-Object {
      [ordered]@{
        hospitalId = $_.hospital_id
        displayName = $_.display_name
        careLevel = $_.care_level
        distanceKm = $_.distance_km
        etaMinutes = $_.eta_minutes
        source = $_.source
        acceptanceStatus = $_.acceptance_status
      }
    })
  } | ConvertTo-Json -Depth 8
  return
}

# A fresh case must first be assigned by the control role. Replays are harmless.
$probe = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId" -Role control -Sub $control.Sub -AllowError
if ($probe.StatusCode -eq 404) {
  $reportedAt = Get-IsoTimestamp ([DateTimeOffset]::UtcNow.AddMinutes(-8))
  $assign = [ordered]@{
    commandId = "seed-case-assigned"
    type = "CASE_ASSIGNED"
    expectedVersion = 0
    payload = [ordered]@{
      assignedParamedicIds = @($paramedic.Sub)
      scenario = "65세 이상 심혈관계 응급 환자 · 흉통·호흡곤란"
      agency = "강원특별자치도 소방본부"
      unitId = "강원119구급대07"
      vehicleNumber = "강원12가1190"
      reportedAt = $reportedAt
    }
  }
  $null = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/commands" -Role control -Sub $control.Sub -Body $assign
} elseif ($probe.StatusCode -ne 200) {
  throw "Unable to probe the demo case."
}

$null = Ensure-Command -Type "DISPATCH_STARTED" -Payload @{} -Role paramedic -Sub $paramedic.Sub
$null = Ensure-Command -Type "ARRIVED_SCENE" -Payload @{} -Role paramedic -Sub $paramedic.Sub
$null = Ensure-Command -Type "PATIENT_CONTACT" -Payload @{} -Role paramedic -Sub $paramedic.Sub

$view = Get-CaseView
if ([int]$view.confirmedState.version -lt 1) {
  $observedAt = Get-IsoTimestamp
  $initialFacts = @(
    @{ path = "patient.age"; value = 74; sourceText = "보호자 확인 74세" },
    @{ path = "patient.sex"; value = "여성"; sourceText = "환자 성별 여성" },
    @{ path = "symptoms.chiefComplaint"; value = "조이는 양상의 흉통과 호흡곤란"; sourceText = "조이는 흉통과 숨참을 호소함" },
    @{ path = "symptoms.onsetAt"; value = (Get-IsoTimestamp ([DateTimeOffset]::UtcNow.AddMinutes(-25))); sourceText = "약 25분 전 증상 발생" },
    @{ path = "symptoms.chestPain"; value = $true; sourceText = "흉통 있음" },
    @{ path = "symptoms.associated"; value = @("식은땀", "구역"); sourceText = "식은땀과 구역 동반" },
    @{ path = "consciousness.avpu"; value = "A"; sourceText = "AVPU A" },
    @{ path = "vitals.systolicBp"; value = 178; observedAt = $observedAt; sourceText = "수축기 혈압 178" },
    @{ path = "vitals.diastolicBp"; value = 96; observedAt = $observedAt; sourceText = "이완기 혈압 96" },
    @{ path = "vitals.pulse"; value = 104; observedAt = $observedAt; sourceText = "맥박 104회/분" },
    @{ path = "vitals.respiratoryRate"; value = 24; observedAt = $observedAt; sourceText = "호흡수 24회/분" },
    @{ path = "vitals.spo2"; value = 93; observedAt = $observedAt; sourceText = "산소포화도 93퍼센트" },
    @{ path = "vitals.temperature"; value = 36.5; observedAt = $observedAt; sourceText = "체온 36.5도" },
    @{ path = "vitals.glucose"; value = 142; observedAt = $observedAt; sourceText = "혈당 142" },
    @{ path = "history.conditions"; value = @("고혈압", "이상지질혈증"); sourceText = "고혈압과 이상지질혈증 과거력" },
    @{ path = "history.medications"; value = @("암로디핀"); sourceText = "암로디핀 복용" },
    @{ path = "history.allergies"; value = @("확인된 약물 알레르기 없음"); sourceText = "알레르기 없음 확인" },
    @{ path = "assessment.ecg"; value = "12유도 심전도에서 ST 분절 상승 의심"; sourceText = "ST 분절 상승 의심 소견" },
    @{ path = "assessment.fieldImpression"; value = "급성 관상동맥증후군 의심"; sourceText = "급성 관상동맥증후군 의심" },
    @{ path = "treatment.oxygen"; value = "비강 캐뉼라 2 L/min"; sourceText = "산소 2리터 투여" }
  )
  $null = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/direct-facts" -Role paramedic -Sub $paramedic.Sub -Body @{ expectedVersion = 0; kind = "initial"; facts = $initialFacts }
}

$requestId = "REQ-GW-CARDIO-050-01"
$directory = (Invoke-BackendRoute -Method GET -Path "/hospitals" -Role paramedic -Sub $paramedic.Sub -Query @{ case_id = $CaseId; lat = "38.2070"; lng = "128.5918" }).Body
if (-not $directory.hospitals -or $directory.hospitals.Count -eq 0) {
  throw "NMC/HIRA reference APIs returned no hospital candidates."
}
$existingSeedRequest = (Get-CaseView).hospitalRequests | Where-Object requestId -eq $requestId | Select-Object -First 1
if ($existingSeedRequest) {
  $selectedHospital = $directory.hospitals | Where-Object hospital_id -eq $existingSeedRequest.hospitalId | Select-Object -First 1
  if (-not $selectedHospital) {
    $selectedHospital = [pscustomobject]@{
      hospital_id = $existingSeedRequest.hospitalId
      display_name = $existingSeedRequest.hospitalName
      source = "existing_request"
      eta_minutes = $null
    }
  }
} else {
  # For a transport inquiry, exclude nearby outpatient/long-term-care facilities and prefer NMC emergency references.
  $selectedHospital = $directory.hospitals | Where-Object {
    $_.hospital_id -and $_.display_name -and $_.source -match "NMC" -and $_.care_level -notmatch "의원|요양병원"
  } | Select-Object -First 1
}
if (-not $selectedHospital) { throw "No usable hospital candidate was returned." }
$hospitalId = [string]$selectedHospital.hospital_id
$hospitalName = [string]$selectedHospital.display_name

$null = & aws cognito-idp admin-update-user-attributes --user-pool-id $userPoolId --username $hospital.Username --user-attributes "Name=custom:hospital_id,Value=$hospitalId" --profile $Profile --region $Region
if ($LASTEXITCODE -ne 0) { throw "Unable to bind the hospital demo user." }

$view = Get-CaseView
if (-not ($view.events.type -contains "HOSPITAL_REQUEST_CREATED")) {
  $null = Ensure-Command -Type "HOSPITAL_REQUEST_CREATED" -Payload @{ requestId = $requestId; hospitalId = $hospitalId; hospitalName = $hospitalName } -Role paramedic -Sub $paramedic.Sub
}
$null = Ensure-Command -Type "HOSPITAL_REQUEST_VIEWED" -Payload @{ requestId = $requestId } -Role hospital -Sub $hospital.Sub -HospitalId $hospitalId
$null = Ensure-Command -Type "HOSPITAL_RESPONSE_RECORDED" -Payload @{ requestId = $requestId; decision = "ACCEPTED" } -Role hospital -Sub $hospital.Sub -HospitalId $hospitalId
$null = Ensure-Command -Type "DESTINATION_CONFIRMED_BY_PARAMEDIC" -Payload @{ requestId = $requestId; hospitalId = $hospitalId } -Role paramedic -Sub $paramedic.Sub
$null = Ensure-Command -Type "TRANSPORT_STARTED" -Payload @{} -Role paramedic -Sub $paramedic.Sub

$view = Get-CaseView
if ([int]$view.confirmedState.version -lt 2) {
  $observedAt = Get-IsoTimestamp
  $reassessmentFacts = @(
    @{ path = "reassessment.systolicBp"; value = 164; observedAt = $observedAt; sourceText = "재평가 수축기 혈압 164" },
    @{ path = "reassessment.diastolicBp"; value = 90; observedAt = $observedAt; sourceText = "재평가 이완기 혈압 90" },
    @{ path = "reassessment.pulse"; value = 96; observedAt = $observedAt; sourceText = "재평가 맥박 96회/분" },
    @{ path = "reassessment.respiratoryRate"; value = 20; observedAt = $observedAt; sourceText = "재평가 호흡수 20회/분" },
    @{ path = "reassessment.spo2"; value = 97; observedAt = $observedAt; sourceText = "산소 투여 후 산소포화도 97퍼센트" },
    @{ path = "reassessment.temperature"; value = 36.5; observedAt = $observedAt; sourceText = "재평가 체온 36.5도" },
    @{ path = "reassessment.glucose"; value = 142; observedAt = $observedAt; sourceText = "재평가 혈당 142" },
    @{ path = "reassessment.avpu"; value = "A"; observedAt = $observedAt; sourceText = "재평가 AVPU A" },
    @{ path = "transport.reassessment"; value = "흉통 NRS 8에서 5로 감소, 혈역학적 악화 없음"; observedAt = $observedAt; sourceText = "이송 중 흉통 감소, 악화 없음" }
  )
  $null = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/direct-facts" -Role paramedic -Sub $paramedic.Sub -Body @{ expectedVersion = 1; kind = "reassessment"; facts = $reassessmentFacts }
}

$null = Ensure-Command -Type "ARRIVED_HOSPITAL" -Payload @{} -Role paramedic -Sub $paramedic.Sub
$null = Ensure-Command -Type "HANDOFF_SENT" -Payload @{ requestId = $requestId; summary = "74세 여성, 급성 관상동맥증후군 의심, 산소 투여 후 재평가 안정"; receiver = "김수용"; role = "응급의학과 간호사" } -Role paramedic -Sub $paramedic.Sub
$null = Ensure-Command -Type "HANDOFF_ACCEPTED" -Payload @{ requestId = $requestId; receiver = "김수용"; role = "응급의학과 간호사" } -Role hospital -Sub $hospital.Sub -HospitalId $hospitalId

$reportResult = Invoke-BackendRoute -Method GET -Path "/cases/$CaseId/report" -Role paramedic -Sub $paramedic.Sub -AllowError
if ($reportResult.StatusCode -eq 404) {
  $reportResult = Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/report/draft" -Role paramedic -Sub $paramedic.Sub -Body @{}
}
$report = $reportResult.Body.report
if ($report.status -eq "DRAFT") {
  $reviewed = @("patientIdentity", "symptomsAndOccurrence", "patientAssessment", "paramedicAssessment", "emergencyCare", "medicalDirection", "transport", "handoff")
  $report = (Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/report/review" -Role paramedic -Sub $paramedic.Sub -Body @{ reviewedFields = $reviewed }).Body.report
}
if ($report.status -ne "FINALIZED") {
  $report = (Invoke-BackendRoute -Method POST -Path "/cases/$CaseId/report/finalize" -Role paramedic -Sub $paramedic.Sub -Body @{}).Body.report
}

$deadline = [DateTime]::UtcNow.AddMinutes(2)
$outboxStatus = $null
do {
  Start-Sleep -Seconds 4
  $query = Invoke-AwsJson @(
    "dynamodb", "query", "--table-name", $tableName,
    "--key-condition-expression", "PK = :pk",
    "--expression-attribute-values", ":pk={S=CASE#$CaseId}"
  )
  $outbox = $query.Items | Where-Object { $_.entityType.S -eq "FHIR_OUTBOX" } | Select-Object -First 1
  if ($outbox) { $outboxStatus = [string]$outbox.status.S }
} while ($outboxStatus -ne "PUBLISHED" -and [DateTime]::UtcNow -lt $deadline)

$final = Get-CaseView
$archive = Invoke-AwsJson @("s3api", "list-objects-v2", "--bucket", $reportBucket, "--prefix", "cases/$CaseId/reports/", "--max-items", "10")
$summary = [ordered]@{
  caseId = $CaseId
  stage = $final.meta.stage
  workflowVersion = $final.meta.version
  confirmedStateVersion = $final.confirmedState.version
  selectedHospital = @{ hospitalId = $hospitalId; displayName = $hospitalName; source = $selectedHospital.source; etaMinutes = $selectedHospital.eta_minutes }
  hospitalRequestStatus = ($final.hospitalRequests | Where-Object requestId -eq $requestId | Select-Object -First 1).status
  reportStatus = $report.status
  reportMissingFields = @($report.draft.missingFields)
  archivedReportObjects = @($archive.Contents).Count
  fhirOutboxStatus = $outboxStatus
  fhirPublishedEvent = [bool]($final.events.type -contains "FHIR_PUBLISHED")
  websocketConfigured = [bool]$outputs.WebSocketUrl
}
$summary | ConvertTo-Json -Depth 10
