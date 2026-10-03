<#
  make-icons.ps1 — generuje ikony i ekrany startowe TeleIPTV (PNG) z jednego wzoru.

  Wzór (przestrzeń projektowa 512x512, zgodna z www/icon.svg):
    * tło  : zaokrąglony kwadrat (albo koło) z gradientem #5b8cff -> #8b5cff
    * znak : biały telewizor (korpus + podstawka) z ciemnym ekranem,
             a na ekranie biały napis "IPTV" (kontur Arial Bold)

  Wynik:
    www\icon.png (80x80)  oraz  www\largeicon.png (130x130)
    www\icon.svg i docs\assets\icon.svg   — ten sam znak jako wektor
    docs\assets\icon.png (512), apple-touch-icon.png (180)
    docs\assets\og.png (1200x630)         — karta do udostępniania linku
    android\app\src\main\res\mipmap-*\ic_launcher.png
                                   \ic_launcher_round.png
                                   \ic_launcher_foreground.png
    android\app\src\main\res\drawable-v24\ic_launcher_foreground.xml
                                   — ten sam znak jako wektor (zapas dla ikony
                                   adaptacyjnej, gdyby ktoś ją przełączył)
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

# ---------- geometria znaku (przestrzeń 512, wyśrodkowana wg otoczki) ----------
# Telewizor: biały korpus, ciemny ekran, napis "IPTV" na ekranie, podstawka.
# Napis jest rozciągany do szerokości ekranu, więc te liczby trzymaj razem.
$script:Body = @{ X = 60.0; Y = 112.0; W = 392.0; H = 228.0; R = 26.0 }
$script:Screen = @{ X = 78.0; Y = 130.0; W = 356.0; H = 192.0; R = 14.0 }
$script:Neck = @{ X = 232.0; Y = 340.0; W = 48.0; H = 28.0; R = 0.0 }
$script:Base = @{ X = 176.0; Y = 368.0; W = 160.0; H = 22.0; R = 11.0 }
$script:Wordmark = @{ Text = 'IPTV'; Width = 296.0; Cx = 256.0; Cy = 226.0 }
$script:ScreenInk = '#0a0c11'
$script:ColorA = '#5b8cff'
$script:ColorB = '#8b5cff'
$script:CornerRadius = 118.0
# Czcionka napisu: pierwsza dostępna z listy (na Windows jest Arial). Do SVG
# trafia gotowy kontur, więc wygląd znaku nie zależy od czcionek odbiorcy.
$script:FontNames = @('Arial', 'Segoe UI', 'Microsoft Sans Serif', 'Verdana', 'Tahoma')
$script:FontFamily = $null

# ---------- ekran startowy (splash) ----------
# Tło splashu to kolor aplikacji (#0a0c11 — ten sam co www/styles.css --bg
# i appinfo.json bgColor). Domyślny splash z szablonu Capacitora był biały,
# więc zamiast logo TeleIPTV pokazywał się obcy znak, a po starcie ekran
# mrugał na biało. Logo zajmuje 26% krótszego boku ekranu.
$script:SplashBg = '#0a0c11'
$script:SplashLogo = 0.26

function Get-GlyphBounds {
  $xs = New-Object System.Collections.Generic.List[double]
  $ys = New-Object System.Collections.Generic.List[double]
  foreach ($s in @($script:Body, $script:Screen, $script:Neck, $script:Base)) {
    $xs.Add([double]$s.X)
    $xs.Add([double]$s.X + [double]$s.W)
    $ys.Add([double]$s.Y)
    $ys.Add([double]$s.Y + [double]$s.H)
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

  # ---- znak: telewizor (korpus + podstawka), ekran i napis IPTV ----
  $matrix = New-GlyphMatrix -Scale $scale -Cx $cx -Cy $cy -GlyphCx $glyphCx -GlyphCy $glyphCy
  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $inkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($script:ScreenInk))

  foreach ($shape in @($script:Body, $script:Neck, $script:Base)) {
    $part = New-ShapePath -Shape $shape
    $part.Transform($matrix)
    $g.FillPath($whiteBrush, $part)
    $part.Dispose()
  }

  $screenPath = New-ShapePath -Shape $script:Screen
  $screenPath.Transform($matrix)
  $g.FillPath($inkBrush, $screenPath)
  $screenPath.Dispose()

  $wordPath = New-WordmarkPath
  if ($wordPath) {
    $wordPath.Transform($matrix)
    $g.FillPath($whiteBrush, $wordPath)
    $wordPath.Dispose()
  }

  $whiteBrush.Dispose()
  $inkBrush.Dispose()
  $matrix.Dispose()


  $g.Dispose()
  return $bmp
}

# ---------- napis "IPTV" (wspólny dla PNG i SVG) ----------

# Liczby do SVG zapisujemy z kropką dziesiętną niezależnie od ustawień
# systemu (polski Excel to przecinek, a SVG wymaga kropki).
function Format-Num {
  param([double]$Value)
  return ([Math]::Round($Value, 2)).ToString('0.##', [System.Globalization.CultureInfo]::InvariantCulture)
}

# Pierwsza czcionka z listy, jaka jest w systemie - bez tego AddString rzuca
# wyjątkiem na maszynie bez Arialu.
function Get-IconFontFamily {
  if ($script:FontFamily) { return $script:FontFamily }
  foreach ($name in $script:FontNames) {
    try {
      $script:FontFamily = New-Object System.Drawing.FontFamily($name)
      return $script:FontFamily
    } catch { }
  }
  $script:FontFamily = [System.Drawing.FontFamily]::GenericSansSerif
  return $script:FontFamily
}

# Napis rysujemy raz w rozmiarze 100, mierzymy otoczkę i rozciągamy do
# zadanej szerokości. Dzięki temu PNG i SVG korzystają z tego samego kształtu.
function New-WordmarkPath {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $origin = New-Object System.Drawing.PointF([single]0, [single]0)
  $path.AddString(
    $script:Wordmark.Text,
    (Get-IconFontFamily),
    [int][System.Drawing.FontStyle]::Bold,
    [single]100.0,
    $origin,
    [System.Drawing.StringFormat]::GenericTypographic)
  $box = $path.GetBounds()
  if ($box.Width -le 0) { return $path }
  $scale = [double]($script:Wordmark.Width / $box.Width)
  $c0x = $box.X + $box.Width / 2.0
  $c0y = $box.Y + $box.Height / 2.0
  $m = New-ScaleMatrix -Scale $scale `
    -OffsetX ($script:Wordmark.Cx - $c0x * $scale) `
    -OffsetY ($script:Wordmark.Cy - $c0y * $scale)
  $path.Transform($m)
  $m.Dispose()
  return $path
}

# Przeskalowanie i przesunięcie zapisane wprost przez elementy macierzy
# (GDI+: m11, m12, m21, m22, dx, dy, czyli x' = x*s + dx). Kolejność wywołań
# Translate/Scale w GDI+ nakłada się na punkty od końca i łatwo się pomylić.
function New-ScaleMatrix {
  param([double]$Scale, [double]$OffsetX, [double]$OffsetY)
  return (New-Object System.Drawing.Drawing2D.Matrix([single]$Scale, [single]0, [single]0, [single]$Scale, [single]$OffsetX, [single]$OffsetY))
}

# Przejście z przestrzeni znaku (512) na bitmapę: wyśrodkuj wg otoczki,
# przeskaluj i przesuń na środek obrazka.
function New-GlyphMatrix {
  param([double]$Scale, [double]$Cx, [double]$Cy, [double]$GlyphCx, [double]$GlyphCy)
  return (New-ScaleMatrix -Scale $Scale `
    -OffsetX ($Cx - $GlyphCx * $Scale) `
    -OffsetY ($Cy - $GlyphCy * $Scale))
}

# Prostokąt (opcjonalnie z zaokrąglonymi rogami) w przestrzeni znaku.
function New-ShapePath {
  param([hashtable]$Shape)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $x = [single]$Shape.X
  $y = [single]$Shape.Y
  $w = [single]$Shape.W
  $h = [single]$Shape.H
  if ([double]$Shape.R -le 0) {
    $path.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h)))
    return $path
  }
  $d = [single]([double]$Shape.R * 2.0)
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc([single]($x + $w - $d), $y, $d, $d, 270, 90)
  $path.AddArc([single]($x + $w - $d), [single]($y + $h - $d), $d, $d, 0, 90)
  $path.AddArc($x, [single]($y + $h - $d), $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
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

# ---------- ten sam znak jako SVG (www/icon.svg, docs/assets/icon.svg) ----------

# Kontur dowolnej ścieżki jako dane SVG i android:pathData (M/L/C + Z). GDI+
# trzyma krzywe sześcienne, więc przenosimy je bez spłaszczania — i SVG, i
# wektor Androida są ostre w każdej skali.
function Get-PathData {
  param([System.Drawing.Drawing2D.GraphicsPath]$Path)
  $sb = New-Object System.Text.StringBuilder
  if ($Path) {
    $pts = $Path.PathPoints
    $types = $Path.PathTypes
    $i = 0
    while ($i -lt $types.Length) {
      $kind = $types[$i] -band 0x07
      $closed = ($types[$i] -band 0x80) -ne 0
      if ($kind -eq 3 -and ($i + 2) -lt $types.Length) {
        $p1 = $pts[$i]
        $p2 = $pts[$i + 1]
        $p3 = $pts[$i + 2]
        [void]$sb.Append('C' + (Format-Num $p1.X) + ' ' + (Format-Num $p1.Y) + ' ' +
          (Format-Num $p2.X) + ' ' + (Format-Num $p2.Y) + ' ' +
          (Format-Num $p3.X) + ' ' + (Format-Num $p3.Y))
        if (($types[$i + 2] -band 0x80) -ne 0) { $closed = $true }
        $i += 3
      } else {
        $cmd = 'L'
        if ($kind -eq 0) { $cmd = 'M' }
        [void]$sb.Append($cmd + (Format-Num $pts[$i].X) + ' ' + (Format-Num $pts[$i].Y))
        $i++
      }
      if ($closed) { [void]$sb.Append('Z') }
    }
  }
  return $sb.ToString()
}

function Get-WordmarkPathData {
  $path = New-WordmarkPath
  $data = ''
  if ($path) {
    $data = Get-PathData -Path $path
    $path.Dispose()
  }
  return $data
}

function Format-SvgRect {
  param([hashtable]$Shape, [string]$Fill)
  $rx = ''
  if ([double]$Shape.R -gt 0) { $rx = ' rx="' + (Format-Num ([double]$Shape.R)) + '"' }
  return '  <rect x="' + (Format-Num ([double]$Shape.X)) + '" y="' + (Format-Num ([double]$Shape.Y)) +
    '" width="' + (Format-Num ([double]$Shape.W)) + '" height="' + (Format-Num ([double]$Shape.H)) + '"' +
    $rx + ' fill="' + $Fill + '"/>'
}

function Get-IconSvg {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="TeleIPTV">')
  $lines.Add('  <title>TeleIPTV</title>')
  $lines.Add('  <desc>Biały telewizor z napisem IPTV na ekranie</desc>')
  $lines.Add('  <defs>')
  $lines.Add('    <linearGradient id="tvbg" x1="0" y1="0" x2="1" y2="1">')
  $lines.Add('      <stop offset="0" stop-color="' + $script:ColorA + '"/>')
  $lines.Add('      <stop offset="1" stop-color="' + $script:ColorB + '"/>')
  $lines.Add('    </linearGradient>')
  $lines.Add('  </defs>')
  $lines.Add('  <rect width="512" height="512" rx="' + (Format-Num $script:CornerRadius) + '" fill="url(#tvbg)"/>')
  foreach ($shape in @($script:Body, $script:Neck, $script:Base)) {
    $lines.Add((Format-SvgRect -Shape $shape -Fill '#ffffff'))
  }
  $lines.Add((Format-SvgRect -Shape $script:Screen -Fill $script:ScreenInk))
  $lines.Add('  <path d="' + (Get-WordmarkPathData) + '" fill="#ffffff"/>')
  $lines.Add('</svg>')
  return (($lines -join "`n") + "`n")
}

# Tekst zapisujemy bez BOM i z końcami linii LF - tak lubią przeglądarki,
# a Gradle czyta XML i tak.
function Save-TextFile {
  param([string]$Path, [string]$Text, [string]$Kind = 'svg')
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ("  {0,-52} {1,4}    {2}" -f $Path.Replace($Root + '\', ''), '', $Kind)
}

# ---------- karta do udostępniania linku (Open Graph, 1200x630) ----------
function New-ShareCardBitmap {
  param([int]$Width = 1200, [int]$Height = 630)

  $bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $rect = New-Object System.Drawing.RectangleF(0, 0, $Width, $Height)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml('#1a2340'),
    [System.Drawing.ColorTranslator]::FromHtml($script:SplashBg),
    [single]60.0)
  $g.FillRectangle($bgBrush, $rect)
  $bgBrush.Dispose()

  $logoSize = 300
  $logo = New-LogoBitmap -Size $logoSize -Mode 'tile'
  $g.DrawImageUnscaled($logo, [int](($Width - $logoSize) / 2), 64)
  $logo.Dispose()

  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

  $family = Get-IconFontFamily
  $titleFont = New-Object System.Drawing.Font($family, [single]96, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subFont = New-Object System.Drawing.Font($family, [single]32, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $smallFont = New-Object System.Drawing.Font($family, [single]26, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sub = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#a8b8d8'))
  $small = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#6f7d9c'))

  $g.DrawString('TeleIPTV', $titleFont, $white, (New-Object System.Drawing.RectangleF(0, 380, $Width, 100)), $fmt)
  $g.DrawString('Odtwarzacz IPTV na LG webOS, Android TV i Fire TV', $subFont, $sub, (New-Object System.Drawing.RectangleF(0, 486, $Width, 40)), $fmt)
  $g.DrawString('M3U i Xtream Codes · EPG/XMLTV · catch-up · ulubione · pilot', $smallFont, $small, (New-Object System.Drawing.RectangleF(0, 528, $Width, 40)), $fmt)

  $white.Dispose()
  $sub.Dispose()
  $small.Dispose()
  $titleFont.Dispose()
  $subFont.Dispose()
  $smallFont.Dispose()
  $fmt.Dispose()
  $g.Dispose()
  return $bmp
}

function Save-ShareCard {
  param([string]$Path, [int]$Width, [int]$Height)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp = New-ShareCardBitmap -Width $Width -Height $Height
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  {0,-52} {1,4}px  {2}" -f $Path.Replace($Root + '\', ''), "${Width}x${Height}", 'og')
}

# ---------- ikona adaptacyjna Androida: wektor pierwszego planu ----------
# mipmap-anydpi-v26/ic_launcher*.xml składa ikonę z drawable/ic_launcher_background
# (gradient z szablonu) i @mipmap/ic_launcher_foreground (PNG z tego generatora).
# drawable-v24/ic_launcher_foreground.xml to zapasowy wektor — rysujemy go z tego
# samego znaku, żeby w repozytorium nie został stary glif z trójkątem "play".
function Get-AndroidForegroundXml {
  $view = 108.0
  $scale = (0.52 * $view) / [double]$script:Body.W
  $box = Get-GlyphBounds
  $glyphCx = ($box.MinX + $box.MaxX) / 2.0
  $glyphCy = ($box.MinY + $box.MaxY) / 2.0
  $m = New-ScaleMatrix -Scale $scale `
    -OffsetX ($view / 2.0 - $glyphCx * $scale) `
    -OffsetY ($view / 2.0 - $glyphCy * $scale)

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($spec in @(
      @{ Shape = $script:Body; Fill = '#FFFFFF' },
      @{ Shape = $script:Neck; Fill = '#FFFFFF' },
      @{ Shape = $script:Base; Fill = '#FFFFFF' },
      @{ Shape = $script:Screen; Fill = $script:ScreenInk })) {
    $shapePath = New-ShapePath -Shape $spec.Shape
    $shapePath.Transform($m)
    [void]$parts.Add('    <path android:fillColor="' + $spec.Fill.ToUpper() +
      '" android:pathData="' + (Get-PathData -Path $shapePath) + '" />')
    $shapePath.Dispose()
  }
  $wordPath = New-WordmarkPath
  if ($wordPath) {
    $wordPath.Transform($m)
    [void]$parts.Add('    <path android:fillColor="#FFFFFF" android:pathData="' +
      (Get-PathData -Path $wordPath) + '" />')
    $wordPath.Dispose()
  }
  $m.Dispose()

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('<?xml version="1.0" encoding="utf-8"?>')
  $lines.Add('<!-- TeleIPTV: biały telewizor z napisem IPTV. Plik generuje')
  $lines.Add('     scripts/make-icons.ps1 - nie edytuj ręcznie. Ikona adaptacyjna')
  $lines.Add('     (mipmap-anydpi-v26) korzysta z @mipmap/ic_launcher_foreground,')
  $lines.Add('     więc ten wektor jest tylko zapasem na wypadek zmiany motywu. -->')
  $lines.Add('<vector xmlns:android="http://schemas.android.com/apk/res/android"')
  $lines.Add('    android:width="108dp"')
  $lines.Add('    android:height="108dp"')
  $lines.Add('    android:viewportWidth="108"')
  $lines.Add('    android:viewportHeight="108">')
  foreach ($part in $parts) { $lines.Add($part) }
  $lines.Add('</vector>')
  return (($lines -join "`n") + "`n")
}

Write-Host "TeleIPTV - generowanie ikon i ekranów startowych w $Root"
Save-Logo -Path (Join-Path $Root 'www\icon.png')      -Size 80  -Mode tile
Save-Logo -Path (Join-Path $Root 'www\largeicon.png') -Size 130 -Mode tile

# Ten sam znak jako wektor: do aplikacji (manifest webOS) i na stronę.
$svg = Get-IconSvg
foreach ($svgRel in @('www\icon.svg', 'docs\assets\icon.svg')) {
  Save-TextFile -Path (Join-Path $Root $svgRel) -Text $svg
}

# Obrazki strony: favicon w PNG (Safari i iOS nie biorą SVG) i karta do
# udostępniania linku (Facebook, X, WhatsApp SVG też odrzucają).
Save-Logo -Path (Join-Path $Root 'docs\assets\icon.png')             -Size 512 -Mode tile
Save-Logo -Path (Join-Path $Root 'docs\assets\apple-touch-icon.png') -Size 180 -Mode tile
Save-ShareCard -Path (Join-Path $Root 'docs\assets\og.png') -Width 1200 -Height 630

# Wektor pierwszego planu ikony adaptacyjnej (zapas dla mipmap-anydpi-v26).
Save-TextFile -Path (Join-Path $Root 'android\app\src\main\res\drawable-v24\ic_launcher_foreground.xml') `
  -Text (Get-AndroidForegroundXml) -Kind 'xml'

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
