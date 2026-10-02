<#
  make-icons.ps1 — generuje ikony i ekrany startowe OpenIPTV (PNG) z jednego wzoru.

  Wzór (przestrzeń projektowa 512x512, zgodna z www/icon.svg):
    * tło  : zaokrąglony kwadrat (albo koło) z gradientem #5b8cff -> #8b5cff
    * glif : biały trójkąt "play" + dwie białe fale (broadcast)

  Wynik:
    www\icon.png (80x80)  oraz  www\largeicon.png (130x130)
    android\app\src\main\res\mipmap-*\ic_launcher.png
                                   \ic_launcher_round.png
                                   \ic_launcher_foreground.png
    android\app\src\main\res\drawable*\splash.png   — ekran startowy: tło
                                   #0a0c11 (kolor aplikacji) + ten sam znak
                                   na środku, w rozmiarach, jakich oczekuje
                                   Capacitor (drawable + land/port w każdej
                                   gęstości)

  Uruchomienie:
    powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#>
[CmdletBinding()]
param(
  [string]$Root
)

if (-not $Root) {
  $here = $PSScriptRoot
  if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
  if (-not $here) { $here = (Get-Location).Path }
  $Root = Split-Path -Parent $here
}

Add-Type -AssemblyName System.Drawing

# ---------- geometria glifu (przestrzeń 512, wyśrodkowana wg otoczki) ----------
$script:Triangle = @(
  @{ X = 86.0;  Y = 150.0 },
  @{ X = 250.0; Y = 256.0 },
  @{ X = 86.0;  Y = 362.0 }
)
$script:Waves = @(
  @{ ChordX = 272.0; Y1 = 176.0; Y2 = 336.0; R = 80.0;  Alpha = 0.62; Stroke = 20.0 },
  @{ ChordX = 308.0; Y1 = 148.0; Y2 = 364.0; R = 108.0; Alpha = 0.36; Stroke = 20.0 }
)
$script:ColorA = '#5b8cff'
$script:ColorB = '#8b5cff'
$script:CornerRadius = 118.0

# ---------- ekran startowy (splash) ----------
# Tło splashu to kolor aplikacji (#0a0c11 — ten sam co www/styles.css --bg
# i appinfo.json bgColor). Domyślny splash z szablonu Capacitora był biały,
# więc zamiast logo OpenIPTV pokazywał się obcy znak, a po starcie ekran
# mrugał na biało. Logo zajmuje 26% krótszego boku ekranu.
$script:SplashBg = '#0a0c11'
$script:SplashLogo = 0.26

function Get-GlyphBounds {
  $xs = New-Object System.Collections.Generic.List[double]
  $ys = New-Object System.Collections.Generic.List[double]
  foreach ($p in $script:Triangle) { $xs.Add($p.X); $ys.Add($p.Y) }
  foreach ($w in $script:Waves) {
    $h = $w.Stroke / 2.0
    $xs.Add($w.ChordX - $h)
    $xs.Add($w.ChordX + $w.R + $h)
    $ys.Add($w.Y1 - $h)
    $ys.Add($w.Y2 + $h)
  }
  [pscustomobject]@{
    MinX = ($xs | Measure-Object -Minimum).Minimum
    MaxX = ($xs | Measure-Object -Maximum).Maximum
    MinY = ($ys | Measure-Object -Minimum).Minimum
    MaxY = ($ys | Measure-Object -Maximum).Maximum
  }
}

function New-LogoBitmap {
  param(
    [int]$Size,
    [ValidateSet('tile', 'round', 'foreground')][string]$Mode = 'tile'
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $bounds = Get-GlyphBounds
  $glyphW = $bounds.MaxX - $bounds.MinX
  $glyphH = $bounds.MaxY - $bounds.MinY
  $glyphCx = ($bounds.MinX + $bounds.MaxX) / 2.0
  $glyphCy = ($bounds.MinY + $bounds.MaxY) / 2.0

  $frac = if ($Mode -eq 'foreground') { 0.52 } else { 0.664 }
  $scale = ($frac * $Size) / $glyphW
  if (($glyphH * $scale) -gt ($Size * 0.84)) { $scale = ($Size * 0.84) / $glyphH }

  $cx = $Size / 2.0
  $cy = $Size / 2.0
  $side = [single]$Size

  # ---- tło ----
  if ($Mode -ne 'foreground') {
    $rect = New-Object System.Drawing.RectangleF(0, 0, $side, $side)
    $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($Mode -eq 'round') {
      $bg.AddEllipse($rect)
    } else {
      $d = [single]($script:CornerRadius * ($Size / 512.0) * 2.0)
      $bg.AddArc([single]0, [single]0, $d, $d, 180, 90)
      $bg.AddArc([single]($side - $d), [single]0, $d, $d, 270, 90)
      $bg.AddArc([single]($side - $d), [single]($side - $d), $d, $d, 0, 90)
      $bg.AddArc([single]0, [single]($side - $d), $d, $d, 90, 90)
      $bg.CloseFigure()
    }
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rect,
      [System.Drawing.ColorTranslator]::FromHtml($script:ColorA),
      [System.Drawing.ColorTranslator]::FromHtml($script:ColorB),
      [single]45.0)
    $g.FillPath($gradBrush, $bg)
    $gradBrush.Dispose()
    $bg.Dispose()
  }

  # ---- trójkąt "play" ----
  $tri = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  foreach ($p in $script:Triangle) {
    $tri.Add((New-Object System.Drawing.PointF(
      [single](($p.X - $glyphCx) * $scale + $cx),
      [single](($p.Y - $glyphCy) * $scale + $cy))))
  }
  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPolygon($whiteBrush, $tri.ToArray())
  $whiteBrush.Dispose()

  # ---- fale "broadcast" (prawa strona) ----
  $stroke = $script:Waves[0].Stroke * $scale
  if ($stroke -ge 2.2) {
    foreach ($w in $script:Waves) {
      $half = ($w.Y2 - $w.Y1) / 2.0
      $wcy = ($w.Y1 + $w.Y2) / 2.0
      $wcx = $w.ChordX - [Math]::Sqrt($w.R * $w.R - $half * $half)
      $a1 = [Math]::Atan2(($w.Y1 - $wcy), ($w.ChordX - $wcx))
      $a2 = [Math]::Atan2(($w.Y2 - $wcy), ($w.ChordX - $wcx))
      $col = [System.Drawing.Color]::FromArgb([int][Math]::Round(255 * $w.Alpha), 255, 255, 255)
      $pen = New-Object System.Drawing.Pen($col, [single]($w.Stroke * $scale))
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $curve = New-Object System.Collections.Generic.List[System.Drawing.PointF]
      $n = 40
      for ($i = 0; $i -le $n; $i++) {
        $ang = $a1 + ($a2 - $a1) * ($i / [double]$n)
        $px = $wcx + $w.R * [Math]::Cos($ang)
        $py = $wcy + $w.R * [Math]::Sin($ang)
        $curve.Add((New-Object System.Drawing.PointF(
          [single](($px - $glyphCx) * $scale + $cx),
          [single](($py - $glyphCy) * $scale + $cy))))
      }
      $wavePath = New-Object System.Drawing.Drawing2D.GraphicsPath
      $wavePath.AddCurve($curve.ToArray())
      $g.DrawPath($pen, $wavePath)
      $pen.Dispose()
      $wavePath.Dispose()
    }
  }

  $g.Dispose()
  return $bmp
}

function Save-Logo {
  param(
    [string]$Path,
    [int]$Size,
    [string]$Mode
  )
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp = New-LogoBitmap -Size $Size -Mode $Mode
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  {0,-52} {1,4}px  {2}" -f $Path.Replace($Root + '\', ''), $Size, $Mode)
}

# Ekran startowy: jednolite tło aplikacji + wyśrodkowany znak. Rozmiar znaku
# liczymy z krótszego boku, więc na szerokim i na pionowym ekranie wygląda
# tak samo duży.
function New-SplashBitmap {
  param(
    [int]$Width,
    [int]$Height
  )

  $bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($script:SplashBg))

  $logoSize = [int][Math]::Round([Math]::Min($Width, $Height) * $script:SplashLogo)
  if ($logoSize -lt 16) { $logoSize = 16 }
  $logo = New-LogoBitmap -Size $logoSize -Mode 'tile'
  $x = [int][Math]::Round(($Width - $logoSize) / 2.0)
  $y = [int][Math]::Round(($Height - $logoSize) / 2.0)
  $g.DrawImageUnscaled($logo, $x, $y)
  $logo.Dispose()

  $g.Dispose()
  return $bmp
}

function Save-Splash {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height
  )
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp = New-SplashBitmap -Width $Width -Height $Height
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  {0,-52} {1,4}px  {2}" -f $Path.Replace($Root + '\', ''), "${Width}x${Height}", 'splash')
}

Write-Host "OpenIPTV - generowanie ikon i ekranów startowych w $Root"
Save-Logo -Path (Join-Path $Root 'www\icon.png')      -Size 80  -Mode tile
Save-Logo -Path (Join-Path $Root 'www\largeicon.png') -Size 130 -Mode tile

$resRoot = Join-Path $Root 'android\app\src\main\res'
$density = @(
  @{ Dir = 'mipmap-mdpi';    Icon = 48;  Fg = 108 },
  @{ Dir = 'mipmap-hdpi';    Icon = 72;  Fg = 162 },
  @{ Dir = 'mipmap-xhdpi';   Icon = 96;  Fg = 216 },
  @{ Dir = 'mipmap-xxhdpi';  Icon = 144; Fg = 324 },
  @{ Dir = 'mipmap-xxxhdpi'; Icon = 192; Fg = 432 }
)
foreach ($d in $density) {
  $dir = Join-Path $resRoot $d.Dir
  Save-Logo -Path (Join-Path $dir 'ic_launcher.png')            -Size $d.Icon -Mode tile
  Save-Logo -Path (Join-Path $dir 'ic_launcher_round.png')      -Size $d.Icon -Mode round
  Save-Logo -Path (Join-Path $dir 'ic_launcher_foreground.png') -Size $d.Fg   -Mode foreground
}

# Ekrany startowe — dokładnie te pliki i te wymiary, których szuka Capacitor
# (android\app\src\main\res\values\styles.xml: AppTheme.NoActionBarLaunch ma
# android:background="@drawable/splash"). Android wybiera wariant land/port
# w swojej gęstości i rozciąga obrazek na całe okno, dlatego każdy wariant ma
# proporcje typowego ekranu w tej gęstości.
$splash = @(
  @{ File = 'drawable\splash.png';               W = 480;  H = 320  },
  @{ File = 'drawable-land-mdpi\splash.png';     W = 480;  H = 320  },
  @{ File = 'drawable-land-hdpi\splash.png';     W = 800;  H = 480  },
  @{ File = 'drawable-land-xhdpi\splash.png';    W = 1280; H = 720  },
  @{ File = 'drawable-land-xxhdpi\splash.png';   W = 1600; H = 960  },
  @{ File = 'drawable-land-xxxhdpi\splash.png';  W = 1920; H = 1280 },
  @{ File = 'drawable-port-mdpi\splash.png';     W = 320;  H = 480  },
  @{ File = 'drawable-port-hdpi\splash.png';     W = 480;  H = 800  },
  @{ File = 'drawable-port-xhdpi\splash.png';    W = 720;  H = 1280 },
  @{ File = 'drawable-port-xxhdpi\splash.png';   W = 960;  H = 1600 },
  @{ File = 'drawable-port-xxxhdpi\splash.png';  W = 1280; H = 1920 }
)
foreach ($s in $splash) {
  Save-Splash -Path (Join-Path $resRoot $s.File) -Width $s.W -Height $s.H
}

Write-Host "Gotowe."
