# Gera o .zip pronto para subir na Chrome Web Store.
# Conteudo: manifest.json (versao Chrome, sem o bloco gecko do Firefox) + dist/ (bundles).
# Uso: pwsh -File scripts/build-chrome-zip.ps1   (compila antes com tsc + esbuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ext = Join-Path $root "extension"
Push-Location $ext
try {
  Write-Host "[chrome] typecheck + bundle (tsc + esbuild)"
  npx tsc --noEmit
  node build.mjs | Out-Null

  $ver = (Get-Content "$ext\manifest.chrome.json" -Raw | ConvertFrom-Json).version
  $stage = Join-Path $env:TEMP ("rrchrome_" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path (Join-Path $stage "dist") | Out-Null
  Copy-Item "$ext\manifest.chrome.json" (Join-Path $stage "manifest.json")
  Copy-Item "$ext\dist\inpage.js","$ext\dist\content.js" (Join-Path $stage "dist")

  $out = "$ext\rift-ranked-chrome-$ver.zip"
  if (Test-Path $out) { Remove-Item $out -Force }
  Compress-Archive -Path (Join-Path $stage "manifest.json"),(Join-Path $stage "dist") -DestinationPath $out
  Remove-Item $stage -Recurse -Force
  Write-Host "[chrome] gerado: $out"
}
finally { Pop-Location }
