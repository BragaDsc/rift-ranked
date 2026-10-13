# Gera extension/dist/riftatlas-ranked.zip a partir de manifest.json + src/.
# Usa ZipArchive.CreateEntry com nomes de entrada em "/" (compatível com Chrome/Firefox).
$ErrorActionPreference = 'Stop'
$ext = Split-Path -Parent $PSCommandPath
$out = Join-Path $ext 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
$zip = Join-Path $out 'riftatlas-ranked.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$za = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
function Add-Entry($archive, $src, $name) {
  $e = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $s = $e.Open(); $b = [System.IO.File]::ReadAllBytes($src); $s.Write($b, 0, $b.Length); $s.Close()
}
Add-Entry $za (Join-Path $ext 'manifest.json') 'manifest.json'
Add-Entry $za (Join-Path $ext 'src/inpage.js') 'src/inpage.js'
Add-Entry $za (Join-Path $ext 'src/content.js') 'src/content.js'
Add-Entry $za (Join-Path $ext 'src/selectors.js') 'src/selectors.js'
$za.Dispose(); $fs.Close()
$v = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host "gerado $zip  (v$v, $((Get-Item $zip).Length) bytes)"
Write-Host "lembre de bater a versao em backend/public/ext/version.json antes de publicar."
