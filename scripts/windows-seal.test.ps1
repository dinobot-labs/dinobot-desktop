$ErrorActionPreference = 'Stop'
$env:REQUIRE_SIGNATURE = 'true'
$root = Join-Path $PSScriptRoot '../reports/seal-negative-fixture'
try {
  New-Item -ItemType Directory -Force "$root/scripts", "$root/apps/desktop/release/win-unpacked/resources/daemon", "$root/core-artifact" | Out-Null
  Copy-Item "$PSScriptRoot/windows-seal.ps1" "$root/scripts/windows-seal.ps1"
  @{version='0.1.5';dinobotDaemon=@{dinobot='0.8.4';bun='1.4.3'}} | ConvertTo-Json | Set-Content "$root/apps/desktop/package.json"
  @{version='0.8.4';sha256=('a'*64)} | ConvertTo-Json | Set-Content "$root/core-artifact/lineage.json"
  @{dinobot='0.8.3';dinobotSha256=('a'*64);bun='1.4.3';os='win';arch='x64'} | ConvertTo-Json | Set-Content "$root/apps/desktop/release/win-unpacked/resources/daemon/daemon.json"
  $rejected = $false
  try { & "$root/scripts/windows-seal.ps1" } catch { if ($_.Exception.Message -notmatch 'identity mismatch') { throw }; $rejected = $true }
  if (!$rejected) { throw 'Mismatched daemon incorrectly accepted' }
  @{dinobot='0.8.4';dinobotSha256=('a'*64);bun='1.4.3';os='win';arch='x64'} | ConvertTo-Json | Set-Content "$root/apps/desktop/release/win-unpacked/resources/daemon/daemon.json"
  Set-Content "$root/apps/desktop/release/dinobot-setup-0.1.5.exe" 'unsigned fixture, never executed'
  $rejected = $false
  try { & "$root/scripts/windows-seal.ps1" } catch { if ($_.Exception.Message -notmatch 'Invalid Authenticode signature') { throw }; $rejected = $true }
  if (!$rejected -or (Test-Path "$root/apps/desktop/release/windows-lineage.json")) { throw 'Unsigned artifact incorrectly sealed' }
  $env:REQUIRE_SIGNATURE = 'false'
  Set-Content "$root/apps/desktop/release/win-unpacked/dinobot.exe" 'unsigned app fixture, never executed'
  Set-Content "$root/apps/desktop/release/win-unpacked/resources/daemon/bun.exe" 'unsigned runtime fixture, never executed'
  & "$root/scripts/windows-seal.ps1"
  $result = Get-Content "$root/apps/desktop/release/windows-lineage.json" | ConvertFrom-Json
  if ($result.installerSigned -ne $false -or $result.signingRequested -ne $false -or !$result.installerSha256) { throw 'Unsigned status or digest incorrectly recorded' }
  Write-Output 'Seal checks passed: daemon mismatch rejected; requested signing rejects unsigned; default unsigned records false plus digest without execution'
} finally { Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue }
