#!/usr/bin/env bash
# Batch diário do Glicko-2 (recompute a partir do histórico de partidas).
set -euo pipefail
APP=/opt/riftatlas-ranked
cd "$APP"
set -a; . ./.env; set +a
NODE="/usr/bin/node"
"$NODE" dist/batch/recompute.js
