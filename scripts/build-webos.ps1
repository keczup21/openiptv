# OpenIPTV - webOS build.
# Stages www/ (plus the optional native fetch service) and packs it into an .ipk.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-webos.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-webos.ps1 -OutDir D:\builds
#
# Requires Node.js + npm and `npm install -g @webos-tools/cli` (ares-package).
param(
    # Optional extra folder the finished .ipk is copied to.
    [string]$OutDir
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$www = Join-Path $root "www"
$stage = Join-Path $root "dist\webos"
$ipkOut = Join-Path $root "dist\ipk"

if (-not (Get-Command ares-package -ErrorAction SilentlyContinue)) {
    throw "ares-package not found. Install it with: npm install -g @webos-tools/cli"
}

Write-Host "Staging webOS app: $stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Recurse -Force (Join-Path $www "*") $stage

# The native fetch service lets the app read remote playlists/EPG without CORS
# limits. The "webos-service" module itself is provided by the TV at runtime, so
# it is not pulled from npm.
$serviceSrc = Join-Path $root "webos-service"
if (Test-Path $serviceSrc) {
    Write-Host "Adding the native webOS fetch service ..."
    Copy-Item -Recurse -Force (Join-Path $serviceSrc "*") $stage
}

New-Item -ItemType Directory -Force -Path $ipkOut | Out-Null
Get-ChildItem -Path $ipkOut -Filter *.ipk -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host "Packaging .ipk ..."
ares-package $stage -o $ipkOut

$ipk = Get-ChildItem -Path $ipkOut -Filter *.ipk -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ipk) { throw "ares-package did not produce an .ipk in $ipkOut" }

# ares-package nazywa wynik "<appid>_<wersja>_all.ipk" (architektura "all", bo to
# czysta aplikacja web). Zmieniamy nazwe na czytelna i spojna z paczka Android.
# Urzadzenie czyta appinfo.json z wnetrza paczki, wiec nazwa pliku nie ma znaczenia.
$ver = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$friendly = Join-Path $ipkOut "OpenIPTV-$ver.ipk"
if ($ipk.FullName -ne $friendly) {
    Move-Item -Force $ipk.FullName $friendly
    $ipk = Get-Item $friendly
}

if ($OutDir) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $dest = Join-Path $OutDir $ipk.Name
    Copy-Item -Force $ipk.FullName $dest
    Write-Host ("Copied to: " + $dest)
}

Write-Host ""
Write-Host "Done. IPK: $($ipk.FullName)"
Write-Host "Install on TV : ares-install -d <device> <file>.ipk"
Write-Host "Launch on TV  : ares-launch  -d <device> pl.openiptv.player"
