$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content "$root/apps/desktop/package.json" | ConvertFrom-Json
$core = Get-Content "$root/core-artifact/lineage.json" | ConvertFrom-Json
$release = "$root/apps/desktop/release"
$installer = "$release/dinobot-setup-$($pkg.version).exe"
$app = "$release/win-unpacked/dinobot.exe"
$bun = "$release/win-unpacked/resources/daemon/bun.exe"
$daemon = Get-Content "$release/win-unpacked/resources/daemon/daemon.json" | ConvertFrom-Json
if ($daemon.dinobot -ne $core.version -or $daemon.dinobotSha256 -ne $core.sha256 -or $daemon.bun -ne $pkg.dinobotDaemon.bun -or $daemon.os -ne 'win' -or $daemon.arch -ne 'x64') { throw 'Packaged daemon identity mismatch' }
$signatures = @()
foreach ($path in @($installer, $app, $bun)) {
  $sig = Get-AuthenticodeSignature -LiteralPath $path
  if ($sig.Status -ne 'Valid') { throw "Invalid Authenticode signature: $path ($($sig.Status))" }
  $signatures += @{ file = (Split-Path $path -Leaf); status = [string]$sig.Status; signer = $sig.SignerCertificate.Thumbprint; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }
}
$source = (git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $source -notmatch '^[0-9a-f]{40}$') { throw 'No Desktop source SHA' }
if ($env:GITHUB_SHA -and $source -ne $env:GITHUB_SHA) { throw 'Desktop source identity mismatch' }
@{ schema = 1; repository = 'dinobot-labs/dinobot-desktop'; sourceSha = $source; version = $pkg.version; platform = 'win-x64'; core = $core; daemon = $daemon; signatures = $signatures; installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant(); acceptance = 'Signature and package identity only; native UI flow and target SAC acceptance still required' } | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$release/windows-lineage.json"
Write-Output 'Sealed signed Windows artifact; installer was NOT executed.'
