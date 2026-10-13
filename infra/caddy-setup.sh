#!/usr/bin/env bash
# Adiciona o roteamento /ranked ao Caddy SEM derrubar o app.
#   prepare: faz backup, insere o bloco, valida e mostra o diff (NÃO recarrega)
#   apply:   troca o arquivo e recarrega; se falhar, restaura o backup
set -euo pipefail
CF=/etc/caddy/Caddyfile
NEW=/tmp/Caddyfile.ranked.new
BAK=/tmp/Caddyfile.ranked.bak
MODE="${1:-prepare}"

case "$MODE" in
  prepare)
    if grep -q "/ranked/\*" "$CF"; then echo "ALREADY_PRESENT"; exit 0; fi
    cp "$CF" "$BAK"
    awk '
      /^app\.megacards\.com\.br[[:space:]]*\{/ && !ins {
        print
        print "    @ranked path /ranked/*"
        print "    handle @ranked {"
        print "        reverse_proxy 127.0.0.1:4100"
        print "    }"
        ins=1; next
      }
      { print }
    ' "$CF" > "$NEW"
    echo "=== DIFF (atual -> novo) ==="
    diff "$CF" "$NEW" || true
    echo "=== VALIDATE ==="
    caddy validate --config "$NEW" --adapter caddyfile
    echo "VALIDATE_OK"
    ;;
  apply)
    [ -f "$NEW" ] || { echo "rode 'prepare' antes"; exit 1; }
    cp "$CF" "${CF}.bak.$(date +%s)"
    cp "$NEW" "$CF"
    if systemctl reload caddy; then
      echo "RELOAD_OK"
    else
      echo "RELOAD_FAILED — restaurando"; cp "$BAK" "$CF"; systemctl reload caddy || true; exit 1
    fi
    ;;
  *) echo "uso: caddy-setup.sh prepare|apply"; exit 2;;
esac
