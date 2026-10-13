#!/usr/bin/env bash
# Backup diário do banco do ranked. Gera um dump gzip e mantém os últimos 14 dias.
set -euo pipefail
APP=/opt/riftatlas-ranked
cd "$APP"
set -a; . ./.env; set +a
DIR="$APP/backups"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/riftatlas_ranked-$STAMP.sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$OUT"
echo "[backup] $(date -Is) -> $OUT ($(du -h "$OUT" | cut -f1))"
# retenção: mantém os 14 mais recentes
ls -1t "$DIR"/riftatlas_ranked-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
