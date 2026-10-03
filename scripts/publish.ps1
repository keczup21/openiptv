# TeleIPTV - szybka publikacja: stage + commit + push do repozytorium na GitHubie.
#
# Poświadczenia trzyma gh (raz zrobione `gh auth login` + `gh auth setup-git`),
# więc push nie pyta o poświadczenia ani o zgodę.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 -Message "poprawka EPG"
#   powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 -Message "wersja 1.19.0" -Tag v1.19.0
param(
    # Treść commita. Można podać też przez npm: npm run publish --message="..."
    [string]$Message,

    # Opcjonalny tag (np. v1.19.0) tworzony i wypychany razem z commitem.
    [string]$Tag,

    # Buduje paczki i tworzy wydanie na GitHubie z gotowymi plikami
    # (.apk + .ipk) - dokladnie tymi, ktore leza w dist.
    [switch]$Release,

    # Opcjonalny plik z opisem wydania (markdown). Bez niego gh generuje notatki.
    [string]$Notes
)

# npm run przekazuje swoje opcje jako zmienne środowiskowe npm_config_*, dzięki
# czemu "npm run publish --message=poprawka EPG" zachowuje całe zdanie.
if (-not $Message) { $Message = $env:npm_config_message }
if (-not $Tag -and $env:npm_config_tag) { $Tag = $env:npm_config_tag }
if ($env:npm_config_release -eq "true") { $Release = $true }
if (-not $Notes -and $env:npm_config_notes) { $Notes = $env:npm_config_notes }

# npm zjada argumenty zaczynajace sie od "-" (np. "-Tag v1.21.0" interpretuje
# jako wlasna flage) i zamiast tagu potrafi podstawic "true". Tag musi wygladac
# jak wersja - inaczej przerywamy, zanim powstanie tag/release o zlej nazwie.
if ($Tag -and $Tag -notmatch '^v?\d+\.\d+\.\d+$') {
    throw ("Tag '$Tag' nie wyglada jak wersja (vX.Y.Z). Przez npm puszczaj z separatorem: " +
           'npm run publish -- -Message "..." -Tag vX.Y.Z -Release')
}

if (-not $Message) {
    throw 'Podaj tresc commita: -Message "..." albo npm run publish -- -Message "..."'
}
if ($Release -and -not $Tag) {
    throw 'Wydanie wymaga tagu: -Tag vX.Y.Z (np. npm run publish -- -Message "wersja X.Y.Z" -Tag vX.Y.Z -Release)'
}

$ErrorActionPreference = "Stop"

# git pisze postęp (np. "To https://github.com/...") na stderr, a przy
# $ErrorActionPreference = "Stop" PowerShell zrobiłby z tego wyjątek - dlatego
# każde wywołanie git idzie przez tę funkcję i liczy się tylko kod wyjścia.
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & git @GitArgs } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) {
        throw ("git " + ($GitArgs -join " ") + " zwrocil kod " + $LASTEXITCODE)
    }
}

# To samo dla npm i gh - oba piszą część komunikatów na stderr.
function Invoke-Exe {
    param(
        [string]$Exe,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExeArgs
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Exe @ExeArgs } finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) {
        throw ("$Exe " + ($ExeArgs -join " ") + " zwrocil kod " + $LASTEXITCODE)
    }
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # Git for Windows dopisuje się do PATH dopiero w nowych sesjach, więc gdy go
    # jeszcze tu nie widać, doglądamy typowe lokalizacje instalacji.
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        foreach ($dir in @(
            (Join-Path $env:ProgramFiles "Git\cmd"),
            (Join-Path ${env:ProgramFiles(x86)} "Git\cmd"),
            (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd")
        )) {
            if (Test-Path (Join-Path $dir "git.exe")) {
                $env:Path = "$dir;$env:Path"
                break
            }
        }
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git nie jest w PATH - doinstaluj Git for Windows."
    }

    $branch = (Invoke-Git rev-parse --abbrev-ref HEAD | Select-Object -First 1).Trim()
    Invoke-Git add -A

    if (-not (Invoke-Git status --porcelain)) {
        Write-Host "Brak zmian do opublikowania (branch $branch)."
        return
    }

    Invoke-Git commit -q -m $Message
    if ($Tag) { Invoke-Git tag -a $Tag -m $Message }

    Write-Host "Wypycham branch $branch ..."
    Invoke-Git push
    if ($Tag) { Invoke-Git push origin $Tag }

    Write-Host ""
    Write-Host "Opublikowane: $Message"
    Invoke-Git log --oneline -1
    Write-Host "Repo: $(Invoke-Git remote get-url origin)"

    if ($Release) {
        Write-Host ""
        Write-Host "Buduje paczki do wydania ..."
        Invoke-Exe npm run build:all

        $ver = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
        $apk = Join-Path $root "dist\android\TeleIPTV-$ver.apk"
        $ipk = Join-Path $root "dist\ipk\TeleIPTV-$ver.ipk"
        foreach ($file in @($apk, $ipk)) {
            if (-not (Test-Path $file)) {
                throw ("Brak paczki: $file. Do wydania ida wylacznie gotowe pliki " +
                       "z dist - najpierw uruchom npm run build:all.")
            }
        }

        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw "Brak gh w PATH - zainstaluj GitHub CLI, zeby tworzyc wydania."
        }

        # Opis wydania bierze sie z CHANGELOG.md i obejmuje TYLKO wydawana
        # wersje. Wczesniej plik z opisem wskazywano recznie (-Notes) i do
        # wydania trafial ogon z poprzednich wersji (np. wydanie 1.20.0
        # opisywalo tez 1.19.4 i 1.19.3) - teraz pilnuje tego generator.
        if (-not $Notes) {
            $Notes = Join-Path $root "dist\release-notes-$ver.md"
            Invoke-Exe node (Join-Path $root "scripts\release-notes.js") $ver
            Write-Host "Opis wydania z CHANGELOG.md: $Notes"
        }
        $versionsInNotes = @(Select-String -Path $Notes -Pattern '^## \[').Count
        if ($versionsInNotes -ne 1) {
            throw ("Opis wydania ($Notes) opisuje " + $versionsInNotes +
                   " wersje - ma byc tylko $ver. Uzyj npm run notes.")
        }

        Write-Host "Tworze wydanie $Tag ..."
        $ghArgs = @("release", "create", $Tag, $apk, $ipk, "--title", "TeleIPTV $ver",
                    "--notes-file", $Notes)
        Invoke-Exe gh @ghArgs
        Write-Host "Wydanie gotowe: $Tag ($(Invoke-Git remote get-url origin))"
    }
} finally {
    Pop-Location
}
