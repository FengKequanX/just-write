#!/usr/bin/env bash
# 获取固定版本并生成差异，不覆盖本地定制。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bun "$ROOT_DIR/scripts/check-upstream.ts" "$@"
