#!/usr/bin/env bash

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="${PROJECT_ROOT:-"$SCRIPT_DIR/.."}"
EXPO_CONSTANTS_PACKAGE_DIR="$(cd "$PROJECT_ROOT/node_modules/expo-constants" && pwd -P)"
DEST="${CONFIGURATION_BUILD_DIR:?CONFIGURATION_BUILD_DIR is required}"
RESOURCE_BUNDLE_NAME="EXConstants.bundle"

cd "$PROJECT_ROOT" || exit 1

if [ "$BUNDLE_FORMAT" = "shallow" ]; then
  RESOURCE_DEST="$DEST/$RESOURCE_BUNDLE_NAME"
elif [ "$BUNDLE_FORMAT" = "deep" ]; then
  RESOURCE_DEST="$DEST/$RESOURCE_BUNDLE_NAME/Contents/Resources"
else
  echo "Unsupported bundle format: $BUNDLE_FORMAT"
  exit 1
fi

mkdir -p "$RESOURCE_DEST"

"${EXPO_CONSTANTS_PACKAGE_DIR}/scripts/with-node.sh" \
  "${EXPO_CONSTANTS_PACKAGE_DIR}/scripts/getAppConfig.js" \
  "$PROJECT_ROOT" \
  "$RESOURCE_DEST"
