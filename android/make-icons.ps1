# Generates the legacy launcher PNGs (Android 6-7) for AM PC Remote.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }

function New-Icon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 16, 32))
  $radius = [int]($size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bg, $path)

  $circle = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 91, 140, 255))
  $margin = [int]($size * 0.12)
  $g.FillEllipse($circle, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin)

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $phoneW = [int]($size * 0.26)
  $phoneH = [int]($size * 0.46)
  $phoneX = [int](($size - $phoneW) / 2)
  $phoneY = [int](($size - $phoneH) / 2)
  $g.FillRectangle($white, $phoneX, $phoneY, $phoneW, $phoneH)

  $screen = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 16, 32))
  $inset = [Math]::Max(2, [int]($size * 0.035))
  $g.FillRectangle($screen, $phoneX + $inset, $phoneY + $inset * 2, $phoneW - 2 * $inset, $phoneH - $inset * 5)

  $dot = [Math]::Max(2, [int]($size * 0.045))
  $g.FillEllipse($white, [int](($size - $dot) / 2), $phoneY + $phoneH - $dot * 2, $dot, $dot)

  $g.Dispose()
  return $bmp
}

foreach ($entry in $sizes.GetEnumerator()) {
  $dir = Join-Path $root "res\mipmap-$($entry.Key)"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $bmp = New-Icon $entry.Value
  $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# A larger copy for the README and any future store listing.
$big = New-Icon 512
$big.Save((Join-Path $root 'icon-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

Write-Output "Launcher icons written."
