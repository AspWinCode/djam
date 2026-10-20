param(
  [string]$ApiUrl = "http://localhost:4000/api",
  [string]$WebUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonGet {
  param(
    [string]$Url,
    $WebSession
  )

  if ($null -ne $WebSession) {
    return Invoke-WebRequest -UseBasicParsing -WebSession $WebSession -Uri $Url
  }

  return Invoke-WebRequest -UseBasicParsing -Uri $Url
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [object]$Body,
    $WebSession,
    [hashtable]$Headers
  )

  $jsonBody = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 10 }
  $params = @{
    UseBasicParsing = $true
    Method = "Post"
    Uri = $Url
    ContentType = "application/json"
  }

  if ($null -ne $jsonBody) {
    $params["Body"] = $jsonBody
  }
  if ($null -ne $WebSession) {
    $params["WebSession"] = $WebSession
  }
  if ($null -ne $Headers) {
    $params["Headers"] = $Headers
  }

  return Invoke-WebRequest @params
}

function Get-Data {
  param($Response)
  return ($Response.Content | ConvertFrom-Json).data
}

function Invoke-FileUpload {
  param(
    [string]$Url,
    [string]$FilePath,
    [string]$CookieHeader
  )

  # Shelling out to curl.exe only works on Windows and breaks on the Linux CI
  # runner (no curl.exe there, and PowerShell Core has no curl alias to fall
  # back on). System.Net.Http.HttpClient does a real multipart/form-data POST
  # and works identically under Windows PowerShell 5.1 and PowerShell Core.
  Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue

  # HttpClient's default handler owns its own CookieContainer and silently drops a
  # manually-set Cookie header unless cookie handling is turned off on the handler.
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseCookies = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  try {
    $client.DefaultRequestHeaders.Add("Origin", "http://localhost:3000")
    $client.DefaultRequestHeaders.Add("Cookie", $CookieHeader)

    $content = [System.Net.Http.MultipartFormDataContent]::new()
    $fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
    $content.Add($fileContent, "file", [System.IO.Path]::GetFileName($FilePath))

    $response = $client.PostAsync($Url, $content).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      throw "Upload failed ($($response.StatusCode)): $body"
    }

    $parsed = $body | ConvertFrom-Json
    if (-not $parsed.data) {
      throw "Upload failed: $body"
    }

    return $parsed.data
  } finally {
    $client.Dispose()
  }
}

Write-Host "Smoke MVP starting..."

$browserHeaders = @{ Origin = "http://localhost:3000" }

$webStatus = (Invoke-WebRequest -UseBasicParsing $WebUrl).StatusCode
$healthResponse = Invoke-WebRequest -UseBasicParsing "$ApiUrl/health"
$health = Get-Data $healthResponse
$healthDetails = Get-Data (Invoke-WebRequest -UseBasicParsing "$ApiUrl/health/details")
$healthRequestId = $healthResponse.Headers["x-request-id"]

Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$ApiUrl/auth/login" -Headers $browserHeaders -ContentType "application/json" -Body (@{ email = "admin@example.com"; password = "admin123" } | ConvertTo-Json) -SessionVariable adminSession | Out-Null
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$ApiUrl/auth/login" -Headers $browserHeaders -ContentType "application/json" -Body (@{ email = "trainer@example.com"; password = "trainer123" } | ConvertTo-Json) -SessionVariable trainerSession | Out-Null

$adminCookie = (($adminSession.Cookies.GetCookies("http://localhost:4000/") | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "; ")

$jams = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/games" -WebSession $adminSession)
$publishedVersions = Get-Data (Invoke-JsonGet -Url "$ApiUrl/trainer/game-versions" -WebSession $trainerSession)
if ($publishedVersions.Count -eq 0) {
  throw "Smoke failed: no published game versions available for trainer."
}

$createdJam = Get-Data (Invoke-JsonPost -Url "$ApiUrl/trainer/jams" -Body @{ title = "Smoke Jam $(Get-Date -Format HHmmss)" } -WebSession $trainerSession -Headers $browserHeaders)
$sessionId = $createdJam.id
Invoke-JsonPost -Url "$ApiUrl/trainer/jams/$sessionId/games" -Body @{ gameVersionId = $publishedVersions[0].id; isDefault = $true } -WebSession $trainerSession -Headers $browserHeaders | Out-Null
Invoke-JsonPost -Url "$ApiUrl/trainer/jams/$sessionId/start" -Body $null -WebSession $trainerSession -Headers $browserHeaders | Out-Null

$sessions = Get-Data (Invoke-JsonGet -Url "$ApiUrl/trainer/jams" -WebSession $trainerSession)
$sessionDetail = Get-Data (Invoke-JsonGet -Url "$ApiUrl/trainer/jams/$sessionId" -WebSession $trainerSession)
$joinCode = $sessionDetail.jam.joinCode

$tmpFile = Join-Path $PSScriptRoot "smoke-upload.txt"
Set-Content -Path $tmpFile -Value "smoke upload $(Get-Date -Format o)"
$uploadedAsset = Invoke-FileUpload -Url "$ApiUrl/admin/media/upload-file" -FilePath $tmpFile -CookieHeader $adminCookie
$auditLogs = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/audit-logs?limit=20" -WebSession $adminSession)
$mediaLibrary = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/media/library" -WebSession $adminSession)
$commercialOverview = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/commercial-overview" -WebSession $adminSession)
$commercialHistory = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/commercial-history?windowDays=30" -WebSession $adminSession)
$organizations = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/organizations" -WebSession $adminSession)
$onboarding = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/organizations/$($organizations[0].id)/onboarding" -WebSession $adminSession)
$invites = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/invites" -WebSession $adminSession)
$templates = Get-Data (Invoke-JsonGet -Url "$ApiUrl/admin/game-templates" -WebSession $adminSession)
$invitePreview = if ($invites.Count -gt 0) { Get-Data (Invoke-JsonGet -Url "$ApiUrl/auth/invites/$($invites[0].token)" -WebSession $null) } else { $null }

$publicSession = Get-Data (Invoke-JsonGet -Url "$ApiUrl/public/jams/$joinCode" -WebSession $null)
$participantName = "Smoke $(Get-Date -Format HHmmss)"
$joinedParticipant = Get-Data (Invoke-JsonPost -Url "$ApiUrl/public/jams/$joinCode/join" -Body @{ displayName = $participantName; avatar = "robot" } -WebSession $null -Headers $null)

$selected = Get-Data (Invoke-JsonPost -Url "$ApiUrl/public/participants/$($joinedParticipant.id)/select-game" -Body @{ gameVersionId = $publicSession.games[0].id } -WebSession $null -Headers $null)
$progressPayload = Get-Data (Invoke-JsonGet -Url "$ApiUrl/public/progress/$($joinedParticipant.id)" -WebSession $null)

$currentStepId = $progressPayload.progress.currentStepId
$openedHint = Get-Data (Invoke-JsonPost -Url "$ApiUrl/public/steps/$currentStepId/open-hint" -Body $null -WebSession $null -Headers @{ "x-participant-id" = $joinedParticipant.id })
$helpRequest = Get-Data (Invoke-JsonPost -Url "$ApiUrl/public/steps/$currentStepId/need-help" -Body $null -WebSession $null -Headers @{ "x-participant-id" = $joinedParticipant.id })

$trainerParticipants = Get-Data (Invoke-JsonGet -Url "$ApiUrl/trainer/jams/$sessionId/participants" -WebSession $trainerSession)
$resolveHelp = Get-Data (Invoke-JsonPost -Url "$ApiUrl/trainer/participants/$($joinedParticipant.id)/resolve-help" -Body $null -WebSession $trainerSession -Headers $browserHeaders)

$currentProgress = $progressPayload.progress
while (-not $currentProgress.isCompleted) {
  $completedProgress = Get-Data (Invoke-JsonPost -Url "$ApiUrl/public/steps/$($currentProgress.currentStepId)/complete" -Body $null -WebSession $null -Headers @{ "x-participant-id" = $joinedParticipant.id })
  $currentProgress = $completedProgress
}

$reviewedProgress = Get-Data (Invoke-JsonPost -Url "$ApiUrl/trainer/participants/$($joinedParticipant.id)/mark-reviewed" -Body $null -WebSession $trainerSession -Headers $browserHeaders)
$participantDetail = Get-Data (Invoke-JsonGet -Url "$ApiUrl/trainer/participants/$($joinedParticipant.id)" -WebSession $trainerSession)

$result = [pscustomobject]@{
  webStatus = $webStatus
  apiHealth = $health.ok
  healthRequestIdPresent = [bool]$healthRequestId
  storage = $health.storage
  uptimeSec = $healthDetails.uptimeSec
  auditLogCount = $healthDetails.counts.auditLogs
  adminAuditVisible = [bool]($auditLogs.items | Where-Object { $_.action -eq "admin.media.upload_file" })
  commercialOverviewLoaded = [bool]$commercialOverview.generatedAt
  commercialHistoryPoints = $commercialHistory.points.Count
  onboardingChecklistCount = $onboarding.summary.totalCount
  invitePreviewValid = if ($null -ne $invitePreview) { $invitePreview.isValid } else { $false }
  mediaQuotaPercent = $mediaLibrary.summary.usagePercent
  orphanedAssets = $mediaLibrary.summary.orphanedAssets
  templatePerformancePresent = [bool](($templates | Select-Object -First 1).PSObject.Properties["completionRate"])
  jams = @($jams).Count
  sessions = @($sessions).Count
  uploadUrl = $uploadedAsset.url
  joinCode = $joinCode
  participantId = $joinedParticipant.id
  firstHintLevel = $openedHint.level
  helpRequested = $helpRequest.needsHelpFlag
  trainerSawParticipant = [bool]($trainerParticipants | Where-Object { $_.participant.id -eq $joinedParticipant.id })
  helpResolved = $resolveHelp.ok
  completed = $currentProgress.isCompleted
  reviewedAt = $reviewedProgress.reviewedAt
  resultSummaryReviewedAt = $participantDetail.resultSummary.reviewedAt
}

$result | ConvertTo-Json -Depth 10
