# OpenIPTV - podbicie numeru wersji we wszystkich miejscach naraz.
#
# Zasada numeracji (patrz tez CHANGELOG.md):
#   gruba zmiana (nowa funkcja, przebudowa) -> srodkowa liczba: 1.19.0 -> 1.20.0
#   poprawka, drobiazg                      -> ostatnia liczba: 1.19.0 -> 1.19.1
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/bump-version.ps1 -Version 1.20.0
#   npm run bump -- 1.20.0                   # gruba zmiana
#   npm run bump -- 1.19.1                   # poprawka albo drobiazg
#
# Podbija cztery miejsca, w ktorych numer wersji jest zapisany w repozytorium:
#   www/app.js (APP_VERSION), www/appinfo.json, package.json
#   oraz android/app/build.gradle (versionName + versionCode).
# versionCode rosnie o 1, chyba ze podasz -VersionCode wprost.
# Skopiowane assety Androida (android/app/src/main/assets) nie sa w repozytorium -
# odswieza je "npx cap sync android" podczas budowania.
param(
    # Nowy numer wersji, np. 1.20.0 (npm run bump -- 1.20.0).
    [Parameter(Position = 0)]
    [string]$Version,

    # Numer wersji dla Androida; domyslnie poprzedni + 1.
    [int]$VersionCode = 0
)

$ErrorActionPreference = "Stop"

# Przez npm argumenty ida po "--", np. "npm run bump -- 1.20.0", bo samo
# "--version" npm przechwytuje i wypisuje wlasna wersje zamiast uruchomic skrypt.
# Zmienne npm_config_* obslugujemy dodatkowo, bo dziala np.
# "npm run bump -- 1.20.0 --versioncode=21".
if (-not $Version -and $env:npm_config_version) { $Version = $env:npm_config_version }
if ($VersionCode -le 0 -and $env:npm_config_versioncode) { $VersionCode = [int]$env:npm_config_versioncode }

if (-not $Version) {
    throw 'Podaj nowa wersje: -Version 1.20.0 albo npm run bump -- 1.20.0'
}
$Version = $Version.Trim().TrimStart("v")
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Numer wersji musi miec postac X.Y.Z (np. 1.20.0), a jest: $Version"
}

$root = Split-Path -Parent $PSScriptRoot

# Pliki zapisujemy jako UTF-8 bez BOM i bez ruszania koncow linii - podmieniamy
# wylacznie sam numer, zeby nie zrobic w repozytorium szumu w calym pliku.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Text {
    param([string]$Path)
    $full = Join-Path $root $Path
    if (-not (Test-Path $full)) { throw "Brak pliku: $full" }
    return [System.IO.File]::ReadAllText($full)
}

function Set-Bumped {
    param([string]$Path, [string]$Pattern, [string]$Replacement)
    $text = Get-Text $Path
    $new = [regex]::Replace($text, $Pattern, $Replacement)
    if ($new -eq $text) {
        throw ("Nie znalazlem numeru wersji w $Path (wzorzec: $Pattern)")
    }
    [System.IO.File]::WriteAllText((Join-Path $root $Path), $new, $utf8NoBom)
}

# Numer musi rosnac - literowka w numerze cofnietym o wersje zepsulaby
# aktualizacje z aplikacji (porownuje numery wydan z GitHubem).
$current = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if ($current -eq $Version) {
    throw "Wersja $Version jest juz ustawiona (package.json) - podaj inna."
}
$oldParts = @($current.Split(".") | ForEach-Object { [int]$_ })
$newParts = @($Version.Split(".") | ForEach-Object { [int]$_ })
$oldValue = $oldParts[0] * 1000000 + $oldParts[1] * 1000 + $oldParts[2]
$newValue = $newParts[0] * 1000000 + $newParts[1] * 1000 + $newParts[2]
if ($newValue -le $oldValue) {
    Write-Warning "$Version nie jest wieksze od $current - wersje powinny rosnac."
}

$gradleText = Get-Text "android\app\build.gradle"
$codeMatch = [regex]::Match($gradleText, 'versionCode\s+(\d+)')
if (-not $codeMatch.Success) {
    throw "Nie znalazlem versionCode w android\app\build.gradle"
}
$oldCode = [int]$codeMatch.Groups[1].Value
if ($VersionCode -le 0) { $VersionCode = $oldCode + 1 }

Set-Bumped "www\app.js"               '(var APP_VERSION\s*=\s*")[^"]+(")'   ('${1}' + $Version + '${2}')
Set-Bumped "www\appinfo.json"         '("version"\s*:\s*")[^"]+(")'        ('${1}' + $Version + '${2}')
Set-Bumped "package.json"             '("version"\s*:\s*")[^"]+(")'        ('${1}' + $Version + '${2}')
Set-Bumped "android\app\build.gradle" '(versionName\s*")[^"]+(")'          ('${1}' + $Version + '${2}')
Set-Bumped "android\app\build.gradle" '(versionCode\s+)\d+'                ('${1}' + $VersionCode)

Write-Host ""
Write-Host "Wersja $current -> ${Version}   (versionCode $oldCode -> $VersionCode)"
Write-Host ""
Write-Host "Podbite miejsca:"
Write-Host ("  www/app.js                  " + [regex]::Match((Get-Text "www\app.js"), 'var APP_VERSION\s*=\s*"[^"]+"').Value)
Write-Host ("  www/appinfo.json            " + [regex]::Match((Get-Text "www\appinfo.json"), '"version"\s*:\s*"[^"]+"').Value)
Write-Host ("  package.json                " + [regex]::Match((Get-Text "package.json"), '"version"\s*:\s*"[^"]+"').Value)
Write-Host ("  android/app/build.gradle    " + [regex]::Match((Get-Text "android\app\build.gradle"), 'versionCode\s+\d+').Value +
             ", " + [regex]::Match((Get-Text "android\app\build.gradle"), 'versionName\s*"[^"]+"').Value)
Write-Host ""
Write-Host "Dalej:"
Write-Host "  1. wpis dla $Version w CHANGELOG.md"
Write-Host "  2. npm run build:all"
Write-Host "  3. npm run publish --message=`"wersja $Version`" -Tag v$Version -Release"
