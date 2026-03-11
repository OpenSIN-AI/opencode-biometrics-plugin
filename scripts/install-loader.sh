#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PWD}"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --plugin)
      PLUGIN_DIR="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

PROJECT_DIR="$(cd "${PROJECT_DIR}" && pwd)"
PLUGIN_DIR="$(cd "${PLUGIN_DIR}" && pwd)"

mkdir -p "${PROJECT_DIR}/.opencode/plugins"

cat > "${PROJECT_DIR}/.opencode/plugins/biometrics.ts" <<EOF
import plugin from "${PLUGIN_DIR}/plugins/biometrics.ts";

export default plugin;
EOF

echo "OK: wrote ${PROJECT_DIR}/.opencode/plugins/biometrics.ts"
echo "Next: run opencode in ${PROJECT_DIR} and use tools biometrics.*"

