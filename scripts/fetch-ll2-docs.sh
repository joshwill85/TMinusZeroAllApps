#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/docs/ll2"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LANDING_URL="https://thespacedevs.com/llapi"
SWAGGER_UI_URL="https://ll.thespacedevs.com/2.3.0/swagger/"
LL2_ORIGIN="https://ll.thespacedevs.com"

mkdir -p "$OUT_DIR"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat > "${OUT_DIR}/SOURCES.txt" <<EOF
Fetched: ${timestamp}
Landing: ${LANDING_URL}
Swagger UI: ${SWAGGER_UI_URL}
EOF

echo "Fetching LL2 docs into: ${OUT_DIR}"

curl -fsSL "$LANDING_URL" -o "${OUT_DIR}/thespacedevs-llapi.html"

swagger_html="${OUT_DIR}/swagger.html"
swagger_fetched="0"
if curl -fsSL "$SWAGGER_UI_URL" -o "$swagger_html"; then
  swagger_fetched="1"
  spec_path="$(
    grep -Eo "url: ['\"][^'\"]+['\"]" "$swagger_html" \
      | head -n 1 \
      | sed -E "s/^url: ['\"]//; s/['\"]$//"
  )"
else
  spec_path=""
fi

declare -a openapi_candidates=(
  "https://ll.thespacedevs.com/2.3.0/swagger/?format=openapi"
  "https://ll.thespacedevs.com/2.3.0/swagger/?format=openapi-json"
  "https://ll.thespacedevs.com/2.3.0/swagger/?format=openapi-yaml"
  "https://ll.thespacedevs.com/2.3.0/swagger.json"
  "https://ll.thespacedevs.com/2.3.0/swagger.yaml"
  "https://ll.thespacedevs.com/2.3.0/openapi.json"
  "https://ll.thespacedevs.com/2.3.0/openapi.yaml"
)

if [[ -n "$spec_path" ]]; then
  if [[ "$spec_path" == http* ]]; then
    openapi_candidates=("$spec_path" "${openapi_candidates[@]}")
  elif [[ "$spec_path" == /* ]]; then
    openapi_candidates=("${LL2_ORIGIN}${spec_path}" "${openapi_candidates[@]}")
  else
    openapi_candidates=("${SWAGGER_UI_URL}${spec_path}" "${openapi_candidates[@]}")
  fi
fi

openapi_tmp="${TMP_DIR}/openapi"
openapi_url=""

for url in "${openapi_candidates[@]}"; do
  if curl -fsSL "$url" -o "$openapi_tmp"; then
    openapi_url="$url"
    break
  fi
done

if [[ -z "$openapi_url" ]]; then
  echo "ERROR: Could not download an OpenAPI spec from known locations." >&2
  echo "Tried:" >&2
  printf '  - %s\n' "${openapi_candidates[@]}" >&2
  exit 1
fi

first_char="$(head -c 1 "$openapi_tmp" || true)"
if [[ "$first_char" == "{" || "$first_char" == "[" ]]; then
  openapi_out="${OUT_DIR}/openapi.json"
else
  openapi_out="${OUT_DIR}/openapi.yaml"
fi

mv "$openapi_tmp" "$openapi_out"
echo "$openapi_url" > "${OUT_DIR}/openapi.source.txt"

echo "Saved:"
echo "  - ${OUT_DIR}/thespacedevs-llapi.html"
if [[ "$swagger_fetched" == "1" ]]; then
  echo "  - ${swagger_html}"
fi
echo "  - ${openapi_out}"
