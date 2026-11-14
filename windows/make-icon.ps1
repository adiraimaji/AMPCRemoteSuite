# Generates icon.ico in this folder for the standalone executable.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outPath = Join-Path $PSScriptRoot 'icon.ico'
$sizes = @(256, 48, 32, 16)

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Dark rounded background with a diagonal blue/purple tint.
  $bg = New-RoundRect 0 0 $size $size ($size * 0.22)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.ColorTranslator]::FromHtml('#14224a'),
    [System.Drawing.ColorTranslator]::FromHtml('#070b16'))
  $g.FillPath($bgBrush, $bg)

  $accent = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point([int]($size * 0.15), [int]($size * 0.2))),
    (New-Object System.Drawing.Point([int]($size * 0.85), [int]($size * 0.85))),
    [System.Drawing.ColorTranslator]::FromHtml('#7fb2ff'),
    [System.Drawing.ColorTranslator]::FromHtml('#a855f7'))
  $stroke = [Math]::Max(2.0, $size * 0.035)
  $pen = New-Object System.Drawing.Pen($accent, $stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  # Monitor.
  $mon = New-RoundRect ($size * 0.17) ($size * 0.23) ($size * 0.47) ($size * 0.33) ($size * 0.04)
  $g.DrawPath($pen, $mon)
  $g.DrawLine($pen, $size * 0.29, $size * 0.65, $size * 0.52, $size * 0.65)
  $g.DrawLine($pen, $size * 0.405, $size * 0.555, $size * 0.405, $size * 0.65)

  # Phone.
  $phone = New-RoundRect ($size * 0.61) ($size * 0.415) ($size * 0.22) ($size * 0.375) ($size * 0.05)
  $phoneBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#0b1020'))
  $g.FillPath($phoneBrush, $phone)
  $g.DrawPath($pen, $phone)
  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#7fb2ff'))
  $dot = [Math]::Max(1.5, $size * 0.018)
  $g.FillEllipse($dotBrush, $size * 0.706, $size * 0.742, $dot, $dot)

  # White "A" mark inside the monitor.
  $white = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#eef2ff'), [Math]::Max(2.0, $size * 0.032))
  $white.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $white.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLines($white, [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(($size * 0.255), ($size * 0.46))),
    (New-Object System.Drawing.PointF(($size * 0.305), ($size * 0.305))),
    (New-Object System.Drawing.PointF(($size * 0.355), ($size * 0.46)))
  ))
  $g.DrawLine($white, $size * 0.275, $size * 0.402, $size * 0.335, $size * 0.402)

  $g.Dispose()
  return $bmp
}

$master = New-IconBitmap 256
$images = @()
foreach ($s in $sizes) {
  if ($s -eq 256) {
    $bmp = $master
  } else {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($master, 0, 0, $s, $s)
    $g.Dispose()
  }
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($s, $ms.ToArray())
  if ($s -ne 256) { $bmp.Dispose() }
  $ms.Dispose()
}
$master.Save((Join-Path $PSScriptRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$master.Dispose()

$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)          # reserved
$bw.Write([UInt16]1)          # type: icon
$bw.Write([UInt16]$images.Count)

$offset = 6 + (16 * $images.Count)
foreach ($entry in $images) {
  $size = [int]$entry[0]
  $data = [byte[]]$entry[1]
  $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $bw.Write([Byte]0)           # palette
  $bw.Write([Byte]0)           # reserved
  $bw.Write([UInt16]1)         # planes
  $bw.Write([UInt16]32)        # bit depth
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($entry in $images) { $bw.Write([byte[]]$entry[1]) }

$bw.Flush()
$bw.Dispose()
$fs.Dispose()
Write-Host "Wrote $outPath ($((Get-Item $outPath).Length) bytes)"
