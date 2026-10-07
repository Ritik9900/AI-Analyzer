<#
.SYNOPSIS
  Builds the Portfolio Analyzer Windows installer (see PACKAGING.md).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\build.ps1 -Version 1.0.0
  powershell -ExecutionPolicy Bypass -File packaging\build.ps1 -Version 1.0.1 -HardExpiry 2027-06-30

.PARAMETER Version     Installer version (shown in Apps & features and the installer file name).
.PARAMETER HardExpiry  Optional YYYY-MM-DD: every copy of THIS build stops working after this date,
                       whatever the licence says. Use it to force people onto newer versions.
.PARAMETER SkipBackend Reuse packaging\build\backend from a previous run (faster UI-only rebuilds).
.PARAMETER ReuseNative Reuse the last Nuitka-compiled app .pyd and redo only the bundling. Use it only when
                       backend code has NOT changed since that compile (e.g. after fixing a bundling problem).
.PARAMETER NoObfuscate Skip JavaScript obfuscation (troubleshooting only).
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [ValidatePattern('^(\d{4}-\d{2}-\d{2})?$')][string]$HardExpiry = "",
  [switch]$SkipBackend,
  [switch]$ReuseNative,
  [switch]$NoObfuscate
)

$ErrorActionPreference = "Stop"
$Pkg = $PSScriptRoot
$Root = Split-Path -Parent $Pkg
$Build = Join-Path $Pkg "build"
$Dist = Join-Path $Pkg "dist"
$Py = Join-Path $Root "backend\.venv\Scripts\python.exe"
$Electron = Join-Path $Pkg "electron"
$sw = [Diagnostics.Stopwatch]::StartNew()

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $exe $($arguments -join ' ')" }
}
function CopyDir([string]$src, [string]$dst) {
  # Replace (not merge into) the destination: Copy-Item onto an existing folder nests it.
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Copy-Item $src $dst -Recurse -Force
}
function Fresh([string]$dir) {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item -ItemType Directory -Force $dir | Out-Null
}

# --- 0. Preflight ----------------------------------------------------------------------------
Step "Preflight checks"
if (-not (Test-Path $Py)) { throw "Python venv not found at $Py. Follow PACKAGING.md, one-time setup." }
$pyVer = & $Py -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ($pyVer -ne "3.12") { Write-Warning "Build venv is Python $pyVer; 3.12 is the tested version." }
foreach ($mod in @("nuitka", "PyInstaller", "cryptography", "fastapi", "yfinance")) {
  & $Py -c "import $mod" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Python module '$mod' missing in the build venv. Run: pip install -r packaging\requirements-build.txt -r backend\requirements.txt" }
}
& $Py -c "import torch, transformers, chronos" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Warning "torch / transformers / chronos not installed: the app will ship WITHOUT local AI models (mock forecasts and sentiment)." }
if (Select-String -Path (Join-Path $Root "backend\app\licensing\public_key.py") -Pattern "NOT_SET" -Quiet) {
  throw "Licence public key not set. Run once: python licensing\make_keys.py (see PACKAGING.md)."
}
foreach ($tool in @("node", "npm")) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found on PATH." } }
# electron-builder 26 loads ES-module-only dependencies (@noble/hashes 2.x) via require(), which needs Node >= 20.19.
$nodeVer = [version]((& node -p "process.versions.node").Trim())
if ($nodeVer -lt [version]"20.19.0") {
  throw "Node.js $nodeVer is too old for the installer builder. Install Node.js 22 LTS (minimum 20.19) from nodejs.org, then delete packaging\electron\node_modules and re-run."
}
Write-Host "Node.js $nodeVer"
New-Item -ItemType Directory -Force $Build, $Dist | Out-Null

# --- 1. Backend: compile to native code, then bundle -----------------------------------------
if (-not $SkipBackend) {
  $Stage = Join-Path $Build "backend-stage"
  $prevPyd = Get-ChildItem (Join-Path $Stage "out") -Filter "app*.pyd" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ReuseNative -and $prevPyd) {
    Step "Backend 1-2/4: reusing compiled $($prevPyd.Name) (-ReuseNative)"
  } else {
  if ($ReuseNative) { Write-Warning "-ReuseNative: no previous compile found, compiling now." }
  Step "Backend 1/4: staging copy with licence enforcement switched on"
  Fresh $Stage
  Copy-Item (Join-Path $Root "backend\app") (Join-Path $Stage "app") -Recurse
  Get-ChildItem $Stage -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
  $expiry = if ($HardExpiry) { "`"$HardExpiry`"" } else { "None" }
  Set-Content -Encoding utf8 (Join-Path $Stage "app\_build_flags.py") @"
REQUIRE_LICENSE = True
BUILD_HARD_EXPIRY = $expiry
BUILD_VERSION = "$Version"
"@

  Step "Backend 2/4: compiling the app package to native code (Nuitka; first run can take 10+ minutes)"
  Push-Location $Stage
  try {
    Run $Py @("-m", "nuitka", "--module", "app", "--include-package=app", "--output-dir=out", "--remove-output", "--no-pyi-file", "--assume-yes-for-downloads")
  } finally { Pop-Location }
  }
  $pyd = Get-ChildItem (Join-Path $Stage "out") -Filter "app*.pyd" | Select-Object -First 1
  if (-not $pyd) { throw "Nuitka did not produce app*.pyd" }

  Step "Backend 3/4: bundling with dependencies (PyInstaller)"
  $Bundle = Join-Path $Build "backend-bundle"
  Fresh $Bundle
  Copy-Item $pyd.FullName $Bundle
  Copy-Item (Join-Path $Pkg "backend\pa_backend.py"), (Join-Path $Pkg "backend\pa_backend.spec") $Bundle
  Copy-Item (Join-Path $Electron "build\icon.ico") $Bundle
  Run $Py @((Join-Path $Pkg "backend\gen_bundle_imports.py"), (Join-Path $Root "backend\app"), (Join-Path $Bundle "bundle_imports.py"))
  Push-Location $Bundle
  try {
    Run $Py @("-m", "PyInstaller", "pa_backend.spec", "--noconfirm", "--clean", "--distpath", (Join-Path $Build "backend"), "--workpath", (Join-Path $Build "pyi-work"))
  } finally { Pop-Location }

  $bundledPyd = Get-ChildItem (Join-Path $Build "backend\pa-backend") -Recurse -Filter "app*.pyd" | Select-Object -First 1
  if (-not $bundledPyd) { throw "The compiled app module was not bundled (no app*.pyd under build\backend\pa-backend). Check the [spec] lines in the PyInstaller output." }
  Write-Host "compiled app module bundled: $($bundledPyd.FullName)"

  Step "Backend 4/4: self-test of the bundled service"
  $SelfTestData = Join-Path $Build "selftest-data"
  Fresh $SelfTestData
  Run (Join-Path $Build "backend\pa-backend\pa-backend.exe") @("--self-test", "--data-dir", $SelfTestData)
  Remove-Item $SelfTestData -Recurse -Force
} else {
  Step "Backend: reusing $Build\backend"
  if (-not (Test-Path (Join-Path $Build "backend\pa-backend\pa-backend.exe"))) { throw "No previous backend build to reuse." }
}

# --- 2. Web UI: Next.js standalone server --------------------------------------------------------
Step "Web 1/3: Next.js production build (standalone)"
$Front = Join-Path $Root "frontend"
Push-Location $Front
try {
  $env:PA_STANDALONE = "1"
  $env:NEXT_TELEMETRY_DISABLED = "1"
  Run "npm" @("run", "build")
} finally {
  Remove-Item Env:PA_STANDALONE -ErrorAction SilentlyContinue
  Pop-Location
}
$Web = Join-Path $Build "web"
Fresh $Web
$Standalone = Join-Path $Front ".next\standalone"
if (-not (Test-Path (Join-Path $Standalone "server.js"))) { throw "Standalone output not found at $Standalone\server.js" }
Get-ChildItem $Standalone -Force | ForEach-Object { CopyDir $_.FullName (Join-Path $Web $_.Name) }
CopyDir (Join-Path $Front ".next\static") (Join-Path $Web ".next\static")
if (Test-Path (Join-Path $Front "public")) { CopyDir (Join-Path $Front "public") (Join-Path $Web "public") }
# Prisma client + native query engine, and the SQL migrations applied on first launch
New-Item -ItemType Directory -Force (Join-Path $Web "node_modules\@prisma"), (Join-Path $Web "prisma") | Out-Null
CopyDir (Join-Path $Front "node_modules\.prisma") (Join-Path $Web "node_modules\.prisma")
CopyDir (Join-Path $Front "node_modules\@prisma\client") (Join-Path $Web "node_modules\@prisma\client")
CopyDir (Join-Path $Front "prisma\migrations") (Join-Path $Web "prisma\migrations")
# Never ship developer configuration or data
Get-ChildItem $Web -Recurse -Force -File | Where-Object { $_.Name -like ".env*" -or $_.Extension -in ".db", ".map" -or $_.Name -like "*.db-journal" } | Remove-Item -Force

Step "Web 2/3: obfuscating server code"
Push-Location $Electron
try {
  # Install exactly what package-lock.json pins. Reinstall when the lock file changed, so hand-edited or
  # stale packages in node_modules can't break the build.
  $stamp = "node_modules\.lock-hash"
  $lockHash = (Get-FileHash "package-lock.json" -Algorithm SHA256).Hash
  if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $lockHash) {
    Run "npm" @("ci")
    Set-Content -Encoding ascii $stamp $lockHash
  }
  if (-not $NoObfuscate) { Run "node" @("scripts/obfuscate-web.mjs", $Web) }
} finally { Pop-Location }

Step "Web 3/3: smoke test (fresh database, migrations, API)"
$SmokeData = Join-Path $Build "smoke-data"
Fresh $SmokeData
$port = Get-Random -Minimum 41000 -Maximum 49000
$env:PORT = "$port"; $env:HOSTNAME = "127.0.0.1"; $env:PA_PACKAGED = "1"; $env:NODE_ENV = "production"
$env:PA_MIGRATIONS_DIR = Join-Path $Web "prisma\migrations"
$env:DATABASE_URL = "file:" + ((Join-Path $SmokeData "smoke.db") -replace '\\', '/')
$env:APP_SECRET = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
$env:BACKEND_URL = "http://127.0.0.1:9"
$proc = Start-Process node -ArgumentList "server.js" -WorkingDirectory $Web -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $SmokeData "out.log") -RedirectStandardError (Join-Path $SmokeData "err.log")
try {
  $ok = $false
  for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 500
    try { $r = Invoke-WebRequest "http://127.0.0.1:$port/api/positions" -UseBasicParsing -TimeoutSec 3; $ok = $r.StatusCode -eq 200 } catch { }
  }
  if (-not $ok) { throw "Web smoke test failed; see $SmokeData\err.log" }
  Write-Host "web server answered; migrations applied"
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  foreach ($v in "PORT", "HOSTNAME", "PA_PACKAGED", "NODE_ENV", "PA_MIGRATIONS_DIR", "DATABASE_URL", "APP_SECRET", "BACKEND_URL") { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
}
Remove-Item $SmokeData -Recurse -Force -ErrorAction SilentlyContinue

# --- 3. Desktop shell + installer -----------------------------------------------------------
Step "Installer 1/3: desktop shell"
Push-Location $Electron
try {
  Run "npm" @("version", $Version, "--no-git-tag-version", "--allow-same-version")
  $prep = @("scripts/prepare-main.mjs"); if ($NoObfuscate) { $prep += "--no-obfuscate" }
  Run "node" $prep

  Step "Installer 2/3: secret and protection scan"
  Run "node" @("scripts/scan-secrets.mjs", $Build, (Join-Path $Electron "dist-main"))

  Step "Installer 3/3: building the NSIS installer (electron-builder)"
  Run "npx" @("electron-builder", "--win", "nsis", "--x64", "--publish", "never")
} finally { Pop-Location }

$exe = Get-ChildItem $Dist -Filter "PortfolioAnalyzer-Setup-$Version.exe" | Select-Object -First 1
if (-not $exe) { throw "Installer not found in $Dist" }
$hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash
Step "Done in $([int]$sw.Elapsed.TotalMinutes) min"
Write-Host ("Installer : {0}" -f $exe.FullName)
Write-Host ("Size      : {0:N0} MB" -f ($exe.Length / 1MB))
Write-Host ("SHA-256   : {0}" -f $hash)
Write-Host "Send the recipient the installer AND this SHA-256 so they can check the download is intact."
