#!/usr/bin/env bash
set -euo pipefail
sliper_source_dir="${1:-}"
sliper_public_env="${2:-}"
case "$sliper_source_dir" in /opt/sliper/releases/*.building/source) ;; *) exit 2;; esac
[ "$(readlink -f "$sliper_source_dir")" = "$sliper_source_dir" ] || exit 2
[ "$sliper_public_env" = /var/lib/sliper/build-public.env ] || exit 2
cd "$sliper_source_dir"
export PATH=/opt/sliper/runtime/node/bin:/usr/local/bin:/usr/bin:/bin
export NPM_CONFIG_CACHE=/var/lib/sliper/npm-cache
export NODE_OPTIONS=--max-old-space-size=3072
export NEXT_TELEMETRY_DISABLED=1
set -a
. "$sliper_public_env"
set +a
printf 'BUILD_NODE='; node --version
printf 'BUILD_UID='; id -u
npm ci --include=dev --no-audit --no-fund
node -e "require('node:fs').chmodSync(require('@ffprobe-installer/ffprobe').path,0o755)"
printf '%s\n' 'SLIPER_DEPENDENCIES_READY=1'
npm run build -- --webpack
printf '%s\n' 'SLIPER_NATIVE_BUILD_READY=1'
