#!/usr/bin/env sh
# Thin wrapper kept for convenience — start.js is the real launcher, so the
# behaviour is identical on every host and platform. See `start.js --help`.
set -e
vault_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "privateprompt: node not found — install Node.js" >&2; exit 1; }
exec node "$vault_dir/start.js" "$@"
