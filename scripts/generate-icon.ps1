Add-Type -AssemblyName System.Drawing

$source = Join-Path $PSScriptRoot '..\resources\icon.png'
$target = Join-Path $PSScriptRoot '..\resources\icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $source))
$frames = New-Object System.Collections.Generic.List[byte[]]

try {
  foreach ($size in $sizes) {
    if ($size -eq 256) {
      # Keep a PNG-encoded 256 frame for electron-builder's minimum-size
      # check; smaller frames remain uncompressed BMP/DIB for Explorer.
      $frames.Add([System.IO.File]::ReadAllBytes((Resolve-Path $source)))
      continue
    }
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
    $graphics.Dispose()

    $memory = New-Object System.IO.MemoryStream
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmpBytes = $memory.ToArray()
    $memory.Dispose()
    $bitmap.Dispose()

    # ICO stores a DIB (BMP without the 14-byte file header); double the
    # height because the AND mask follows the XOR bitmap in an ICO frame.
    $dib = New-Object byte[] ($bmpBytes.Length - 14)
    [Array]::Copy($bmpBytes, 14, $dib, 0, $dib.Length)
    [BitConverter]::GetBytes([int]($size * 2)).CopyTo($dib, 8)
    $frames.Add($dib)
  }
}
finally {
  $sourceImage.Dispose()
}

$stream = New-Object System.IO.FileStream((Resolve-Path $target), [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($stream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$frames.Count)
  $offset = 6 + (16 * $frames.Count)
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $size = $sizes[$i]
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frames[$i].Length)
    $writer.Write([UInt32]$offset)
    $offset += $frames[$i].Length
  }
  foreach ($frame in $frames) { $writer.Write($frame) }
}
finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Output "Generated $target with sizes: $($sizes -join ', ')"
