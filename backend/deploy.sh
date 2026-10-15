#!/usr/bin/env bash
# Deploy idempotente do backend ranked na VPS.
# NÃO toca em Caddy nem em outros serviços. Só: Postgres (db dedicado) + pm2.
#
# Parametrizável por ambiente (prod é o default — comportamento inalterado):
#   APP_DIR   diretório do bundle         (default /opt/riftatlas-ranked)
#   DB_NAME   banco Postgres dedicado     (default riftatlas_ranked)
#   DB_USER   role Postgres dedicada      (default ranked)
#   PORT      porta HTTP/WS do processo   (default 4100)
#   PM2_NAME  nome do processo no pm2     (default riftatlas-ranked)
#
# IMPORTANTE: staging usa DB_USER PRÓPRIO (ex.: ranked_staging). Se compartilhasse
# a role com o prod, o ALTER ROLE ... PASSWORD do deploy de staging trocaria a
# senha da role e derrubaria a conexão do prod.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/riftatlas-ranked}"
DB_NAME="${DB_NAME:-riftatlas_ranked}"
DB_USER="${DB_USER:-ranked}"
PORT="${PORT:-4100}"
PM2_NAME="${PM2_NAME:-riftatlas-ranked}"
ENV_FILE="$APP_DIR/.env"

echo "[deploy] alvo: dir=$APP_DIR db=$DB_NAME user=$DB_USER port=$PORT pm2=$PM2_NAME"
cd "$APP_DIR"

# 1) credenciais: reaproveita .env se existir, senão gera senha hex (sem caracteres especiais)
if [ -f "$ENV_FILE" ] && grep -q DATABASE_URL "$ENV_FILE"; then
  echo "[deploy] .env existente — reaproveitando credenciais"
else
  DB_PASS="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<ENV
PORT=${PORT}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
ENV
  chmod 600 "$ENV_FILE"
  echo "[deploy] .env criado"
fi
# token do painel de disputas (gerado uma vez)
if ! grep -q "^ADMIN_TOKEN=" "$ENV_FILE"; then
  echo "ADMIN_TOKEN=$(openssl rand -hex 24)" >> "$ENV_FILE"
  echo "[deploy] ADMIN_TOKEN gerado"
fi
set -a; . "$ENV_FILE"; set +a
DB_PASS="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"

# 2) role + database (idempotente)
sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'; ELSE ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}'; END IF; END \$\$;"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  echo "[deploy] database ${DB_NAME} criado"
fi

# 3) schema (só na primeira vez)
HAS=$(PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT to_regclass('public.players')" || true)
if [ "$HAS" != "players" ]; then
  echo "[deploy] aplicando schema"
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f db/schema.sql
else
  echo "[deploy] schema já presente"
fi

# 3b) migrações idempotentes (rodam a cada deploy)
if [ -f db/migrations.sql ]; then
  echo "[deploy] migrações"
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f db/migrations.sql
fi

# 4) dependências de runtime
npm ci --omit=dev

# 5) pm2 (start ou restart)
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start dist/index.js --name "$PM2_NAME" --update-env
fi
pm2 save

sleep 1
echo "[deploy] health check:"
curl -s "http://127.0.0.1:${PORT}/ranked/api/health" && echo || echo "(sem resposta — ver 'pm2 logs ${PM2_NAME}')"
