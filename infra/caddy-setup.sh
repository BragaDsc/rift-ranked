#!/usr/bin/env bash
# Adiciona roteamento ao Caddy SEM derrubar o app.
#
#   prepare | apply                  → rota de PRODUÇÃO  /ranked/*  → 127.0.0.1:4100
#   prepare-staging | apply-staging  → rota de TESTES    /staging/* → 127.0.0.1:4101
#
# prepare*: backup, insere o bloco, valida e mostra o diff (NÃO recarrega)
# apply*:   troca o arquivo e recarrega; se falhar, restaura o backup
#
# A rota de staging usa `handle_path`, que REMOVE o prefixo /staging antes do
# proxy — então o backend de teste segue atendendo em /ranked/* sem mudar código:
#   wss://app.megacards.com.br/staging/ranked/ws  →  backend vê  /ranked/ws
set -euo pipefail
CF=/etc/caddy/Caddyfile
MODE="${1:-prepare}"

# $1 marcador já presente, $2 arquivo NEW, $3 arquivo BAK, $4 bloco awk a inserir
prepare_block() {
  local marker="$1" NEW="$2" BAK="$3" awk_prog="$4"
  if grep -q "$marker" "$CF"; then echo "ALREADY_PRESENT"; exit 0; fi
  cp "$CF" "$BAK"
  awk "$awk_prog" "$CF" > "$NEW"
  echo "=== DIFF (atual -> novo) ==="
  diff "$CF" "$NEW" || true
  echo "=== VALIDATE ==="
  caddy validate --config "$NEW" --adapter caddyfile
  echo "VALIDATE_OK"
}

apply_block() {
  local NEW="$1" BAK="$2"
  [ -f "$NEW" ] || { echo "rode o 'prepare' correspondente antes"; exit 1; }
  cp "$CF" "${CF}.bak.$(date +%s)"
  cp "$NEW" "$CF"
  if systemctl reload caddy; then
    echo "RELOAD_OK"
  else
    echo "RELOAD_FAILED — restaurando"; cp "$BAK" "$CF"; systemctl reload caddy || true; exit 1
  fi
}

case "$MODE" in
  prepare)
    prepare_block "/ranked/\*" /tmp/Caddyfile.ranked.new /tmp/Caddyfile.ranked.bak '
      /^app\.megacards\.com\.br[[:space:]]*\{/ && !ins {
        print
        print "    @ranked path /ranked/*"
        print "    handle @ranked {"
        print "        reverse_proxy 127.0.0.1:4100"
        print "    }"
        ins=1; next
      }
      { print }
    '
    ;;
  apply)
    apply_block /tmp/Caddyfile.ranked.new /tmp/Caddyfile.ranked.bak
    ;;
  prepare-staging)
    prepare_block "/staging/\*" /tmp/Caddyfile.staging.new /tmp/Caddyfile.staging.bak '
      /^app\.megacards\.com\.br[[:space:]]*\{/ && !ins {
        print
        print "    handle_path /staging/* {"
        print "        reverse_proxy 127.0.0.1:4101"
        print "    }"
        ins=1; next
      }
      { print }
    '
    ;;
  apply-staging)
    apply_block /tmp/Caddyfile.staging.new /tmp/Caddyfile.staging.bak
    ;;
  *) echo "uso: caddy-setup.sh prepare|apply|prepare-staging|apply-staging"; exit 2;;
esac
