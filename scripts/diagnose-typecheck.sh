#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TSC_BIN="${ROOT_DIR}/node_modules/.bin/tsc"
WEB_DIR="${ROOT_DIR}/apps/web"

if [[ ! -e "$TSC_BIN" ]]; then
  echo "ERROR: Missing ${TSC_BIN}. Did you run npm install?" >&2
  exit 1
fi

mkdir -p "${WEB_DIR}/.next/cache/tsc"

tsc_args=("$TSC_BIN" "--project" "${WEB_DIR}/tsconfig.json" "--noEmit" "--pretty" "false" "--extendedDiagnostics")
if [[ "${DIAG_TSC_TRACE:-0}" == "1" ]]; then
  tsc_args+=("--generateTrace" "__DIAG_RUN_DIR__/tsc-trace")
fi

bash "${ROOT_DIR}/scripts/diagnose-command.sh" "typecheck" "${tsc_args[@]}" "$@"
