#!/usr/bin/env bash
# Build + deploy do BACKEND: compila o TS, empacota e aplica no VPS via deploy.sh
# (que roda schema/migrações idempotentes e reinicia o pm2).
#
# Requer:
#   RANKED_SSH_KEY  caminho da chave SSH de deploy (obrigatório)
#   RANKED_HOST     destino ssh (default: root@161.97.154.186)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${RANKED_SSH_KEY:?defina RANKED_SSH_KEY com o caminho da chave de deploy}"
HOST="${RANKED_HOST:-root@161.97.154.186}"
APP="/opt/riftatlas-ranked"

cd "$HERE/backend"
echo "[push] typecheck + build TypeScript -> dist/"
npm run build

echo "[push] empacotando bundle (dist, db, public, package, scripts)"
TMP="$(mktemp -d)"
tar -czf "$TMP/bundle.tgz" dist db public package.json package-lock.json deploy.sh backup.sh batch.sh

echo "[push] enviando e aplicando (deploy.sh = migrações idempotentes + restart)"
scp -i "$KEY" "$TMP/bundle.tgz" "$HOST:$APP/bundle.tgz"
ssh -i "$KEY" "$HOST" "cd $APP && tar -xzf bundle.tgz && rm -f bundle.tgz && bash deploy.sh"
rm -rf "$TMP"
echo "[push] backend publicado."
