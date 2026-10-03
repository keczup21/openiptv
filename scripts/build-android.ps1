# TeleIPTV - Android build (Android TV / Google TV boxes, incl. Amazon Fire TV).
# Wraps the shared www/ app with Capacitor and calls Gradle to produce an APK.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -OutDir D:\builds
#
# Buduje wersje developerska (Gradle assembleDebug) i zapisuje ja jako
# TeleIPTV-<wersja>.apk - dokladnie w takiej postaci idzie na GitHuba.
# Poza repozytorium nie trzeba nic przygotowywac: wystarczy sklonowane repo,
# Node.js i Android SDK.
#
# Requires Node.js + npm, JDK 17 (Gradle 8.2 rejects newer JDKs) and the Android
# SDK with platform-tools, android-34 and build-tools 34.0.0. JAVA_HOME and
# ANDROID_HOME may be set beforehand; otherwise the usual install locations are
# probed.
param(
    # Where the finished APK is copied. Defaults to dist\android inside the repo.
    [string]$OutDir
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    foreach ($candidate in @((Join-Path $env:LOCALAPPDATA "Android\Sdk"), (Join-Path $env:USERPROFILE "Android\Sdk"))) {
        if (Test-Path $candidate) { $env:ANDROID_HOME = $candidate; break }
    }
}

if (-not $env:JAVA_HOME) {
    Write-Warning "JAVA_HOME is empty and no JDK 17 was found in Program Files\Eclipse Adoptium."
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT -and -not (Test-Path (Join-Path $root "android\local.properties"))) {
    Write-Warning "Android SDK not found. Set ANDROID_HOME or add sdk.dir=... to android\local.properties."
}
Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root "node_modules"))) {
        Write-Host "Installing npm dependencies ..."
        npm install
    }

    if (-not (Test-Path (Join-Path $root "android"))) {
        Write-Host "Adding Android platform ..."
        npx cap add android
    }

    # Gradle takes the SDK location from android\local.properties, which is not
    # kept in the repository, so write it once if it is missing.
    $localProps = Join-Path $root "android\local.properties"
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
    if (-not (Test-Path $localProps) -and $sdk) {
        ("sdk.dir=" + $sdk.Replace('\', '\\')) | Set-Content -Path $localProps -Encoding ASCII
        Write-Host "Wrote android\local.properties (sdk.dir=$sdk)"
    }

    Write-Host "Syncing web assets into the Android project ..."
    npx cap sync android

    $androidDir = Join-Path $root "android"
    Push-Location $androidDir
    try {
        if (-not (Test-Path ".\gradlew.bat")) {
            throw "gradlew.bat not found in $androidDir (run 'npx cap add android' first)."
        }
        Write-Host "Running gradle assembleDebug ..."
        .\gradlew.bat assembleDebug
    } finally {
        Pop-Location
    }

    $apkPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path $apkPath)) {
        throw "Gradle finished but the APK is missing: $apkPath"
    }

    # Copy the APK under a readable, versioned name.
    $ver = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
    $target = if ($OutDir) { $OutDir } else { Join-Path $root "dist\android" }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $dest = Join-Path $target "TeleIPTV-$ver.apk"
    Copy-Item -Force $apkPath $dest

    Write-Host ""
    Write-Host "Done. APK: $dest"
    Write-Host "Install on the TV box: adb connect <ip>:5555 ; adb install -r `"$dest`""
} finally {
    Pop-Location
}
