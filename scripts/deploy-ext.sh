#!/usr/bin/env bash
# Publica a EXTENSÃO: envia o zip (gerado por extension/build-ext.ps1) + version.json
# e reinicia o pm2 (o servidor carrega o zip/version em memória no boot).
#
# Requer:
#   RANKED_SSH_KEY  caminho da chave SSH de deploy (obrigatório)
#   RANKED_HOST     destino ssh (obrigatório, ex.: root@seu-servidor)
#
# Antes de rodar: gere o zip e bata a versão em backend/public/ext/version.json.
#   pwsh extension/build-ext.ps1   (ou PowerShell no Windows)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${RANKED_SSH_KEY:?defina RANKED_SSH_KEY com o caminho da chave de deploy}"
HOST="${RANKED_HOST:?defina RANKED_HOST com o destino ssh, ex.: root@seu-servidor}"
APP="/opt/riftatlas-ranked"
ZIP="$HERE/extension/dist/riftatlas-ranked.zip"
VER="$HERE/backend/public/ext/version.json"

[ -f "$ZIP" ] || { echo "ERRO: $ZIP não existe — rode extension/build-ext.ps1 primeiro"; exit 1; }

echo "[ext] enviando zip + version.json"
scp -i "$KEY" "$ZIP" "$HOST:$APP/public/ext/riftatlas-ranked.zip"
scp -i "$KEY" "$VER" "$HOST:$APP/public/ext/version.json"
echo "[ext] restart pm2 (recarrega zip/version)"
ssh -i "$KEY" "$HOST" "pm2 restart riftatlas-ranked"
echo "[ext] extensão publicada. Confira: curl -s https://app.megacards.com.br/ranked/api/ext-version"
