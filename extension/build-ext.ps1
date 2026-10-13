# Gera extension/dist/riftatlas-ranked.zip: bundla os TS com esbuild e empacota
# manifest.json + os bundles (dist/inpage.js, dist/content.js).
$ErrorActionPreference = 'Stop'
$ext = Split-Path -Parent $PSCommandPath

# 1) bundle TS -> dist/*.js (esbuild)
Push-Location $ext
try { & npm run build; if ($LASTEXITCODE -ne 0) { throw "esbuild falhou" } } finally { Pop-Location }

# 2) empacota o zip
$out = Join-Path $ext 'dist'
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
Add-Entry $za (Join-Path $out 'inpage.js') 'dist/inpage.js'
Add-Entry $za (Join-Path $out 'content.js') 'dist/content.js'
Add-Entry $za (Join-Path $ext 'icons/icon16.png') 'icons/icon16.png'
Add-Entry $za (Join-Path $ext 'icons/icon48.png') 'icons/icon48.png'
Add-Entry $za (Join-Path $ext 'icons/icon128.png') 'icons/icon128.png'
$za.Dispose(); $fs.Close()
$v = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host "gerado $zip  (v$v, $((Get-Item $zip).Length) bytes)"
Write-Host "lembre de bater a versao em backend/public/ext/version.json antes de publicar."
