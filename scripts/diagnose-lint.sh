#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_BIN="${ROOT_DIR}/node_modules/.bin/next"
WEB_DIR="${ROOT_DIR}/apps/web"

if [[ ! -e "$NEXT_BIN" ]]; then
  echo "ERROR: Missing ${NEXT_BIN}. Did you run npm install?" >&2
  exit 1
fi

bash "${ROOT_DIR}/scripts/diagnose-command.sh" "lint" bash -lc "cd \"${WEB_DIR}\" && \"${NEXT_BIN}\" lint"
