param(
  [switch]$Run,
  [Parameter(Mandatory=$true)][string]$StatusDirectory
)
# Safe wrapper for Windows Task Scheduler. Does not create a scheduled task.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not [System.IO.Path]::IsPathRooted($StatusDirectory)) {
  throw 'StatusDirectory must be absolute.'
}
if (-not (Test-Path -LiteralPath $StatusDirectory -PathType Container)) {
  throw 'StatusDirectory must exist.'
}
if (-not $Run) {
  Write-Host 'DRY_RUN_ONLY. No backup started. Pass -Run after configuration review.'
  exit 0
}
$logPath = Join-Path $StatusDirectory 'backup-status.json'
$started = (Get-Date).ToUniversalTime().ToString('o')
$ok = $false
Push-Location $repoRoot
try {
  # Never record process output: database driver messages can contain secrets.
  & npm run backup:mongodb -- --create 1>$null 2>$null
  $ok = ($LASTEXITCODE -eq 0)
} catch {
  $ok = $false
} finally {
  Pop-Location
  $record = @{
    utc = (Get-Date).ToUniversalTime().ToString('o')
    startedUtc = $started
    status = $(if ($ok) { 'success' } else { 'failed' })
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText($logPath, $record, [System.Text.Encoding]::UTF8)
}
if ($ok) {
  Write-Host 'BACKUP_COMPLETE. Status file updated.'
  exit 0
}
Write-Error 'BACKUP_FAILED. Check encrypted backup configuration and Atlas connectivity.'
exit 1
