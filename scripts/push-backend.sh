#!/usr/bin/env bash
# Build + deploy do BACKEND: compila o TS, empacota e aplica no VPS via deploy.sh
# (que roda schema/migrações idempotentes e reinicia o pm2).
#
# Uso:
#   scripts/push-backend.sh            # alvo = prod (default)
#   scripts/push-backend.sh prod       # idem
#   scripts/push-backend.sh staging    # servidor de TESTES (porta 4101, db próprio)
#
# O MESMO bundle (dist/db/public) vai para os dois ambientes; o que muda é só o
# destino: diretório, banco, role, porta e nome do processo pm2. Assim você testa
# o código novo no staging e só depois promove pro prod.
#
# Requer (via scripts/deploy.local.env — git-ignorado — ou ambiente):
#   RANKED_SSH_KEY  caminho da chave SSH de deploy
#   RANKED_HOST     destino ssh (ex.: root@seu-servidor)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# carrega config local de deploy (RANKED_HOST/RANKED_SSH_KEY), se existir — git-ignorada
[ -f "$HERE/scripts/deploy.local.env" ] && . "$HERE/scripts/deploy.local.env"
KEY="${RANKED_SSH_KEY:?defina RANKED_SSH_KEY com o caminho da chave de deploy}"
HOST="${RANKED_HOST:?defina RANKED_HOST com o destino ssh, ex.: root@seu-servidor}"

TARGET="${1:-prod}"
case "$TARGET" in
  prod)
    APP="/opt/riftatlas-ranked"
    REMOTE_ENV="APP_DIR=/opt/riftatlas-ranked DB_NAME=riftatlas_ranked DB_USER=ranked PORT=4100 PM2_NAME=riftatlas-ranked"
    ;;
  staging)
    APP="/opt/riftatlas-ranked-staging"
    REMOTE_ENV="APP_DIR=/opt/riftatlas-ranked-staging DB_NAME=riftatlas_ranked_staging DB_USER=ranked_staging PORT=4101 PM2_NAME=riftatlas-ranked-staging"
    ;;
  *) echo "alvo inválido: '$TARGET' (use prod|staging)"; exit 2;;
esac
echo "[push] alvo = $TARGET  →  $APP"

cd "$HERE/backend"
echo "[push] typecheck + build TypeScript -> dist/"
npm run build

echo "[push] empacotando bundle (dist, db, public, package, scripts)"
TMP="$(mktemp -d)"
tar -czf "$TMP/bundle.tgz" dist db public package.json package-lock.json deploy.sh backup.sh batch.sh

echo "[push] enviando e aplicando (deploy.sh = migrações idempotentes + restart)"
ssh -i "$KEY" "$HOST" "mkdir -p $APP"
scp -i "$KEY" "$TMP/bundle.tgz" "$HOST:$APP/bundle.tgz"
ssh -i "$KEY" "$HOST" "cd $APP && tar -xzf bundle.tgz && rm -f bundle.tgz && $REMOTE_ENV bash deploy.sh"
rm -rf "$TMP"
echo "[push] backend ($TARGET) publicado."
