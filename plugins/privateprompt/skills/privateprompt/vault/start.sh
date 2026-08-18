#!/usr/bin/env bash
# Start the Private Prompt Vault server if it isn't already up, then open it.
#
# One command instead of a health probe, a start, and an open: the probe is what
# makes it safe to run repeatedly, and this script does that probe for you.
#
#   ./start.sh                # start (if needed) and open for the current directory
#   ./start.sh --cwd /path    # use another project directory
#   ./start.sh --no-open      # start only, print the URL
#   ./start.sh --stop         # stop the running server
#
# Honors PRIVATEPROMPT_PORT, PRIVATEPROMPT_RUNTIME, and PRIVATEPROMPT_DATA_DIR.
set -euo pipefail

vault_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server="$vault_dir/privateprompt-server.js"
port="${PRIVATEPROMPT_PORT:-8974}"
project_dir="$PWD"
open_page=1

# Which agent runtime owns the data directory. The host's own plugin-root
# variable is the most reliable signal for how this copy was installed.
if [ -n "${PRIVATEPROMPT_RUNTIME:-}" ]; then
  runtime="$PRIVATEPROMPT_RUNTIME"
elif [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  runtime="cursor"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  runtime="claude"
else
  runtime="codex"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --cwd) project_dir="${2:-$PWD}"; shift 2 ;;
    --no-open) open_page=0; shift ;;
    --stop)
      if pkill -f "privateprompt-server.js" 2>/dev/null; then
        echo "privateprompt: stopped"
      else
        echo "privateprompt: nothing to stop"
      fi
      exit 0
      ;;
    --port) port="${2:-$port}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "privateprompt: unknown option $1" >&2; exit 2 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "privateprompt: node not found — install Node.js" >&2; exit 1; }
[ -f "$server" ] || { echo "privateprompt: server missing at $server" >&2; exit 1; }

health="$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)"

if [ -n "$health" ]; then
  # Already serving. A different runtime means a different data directory, so
  # reusing it would read and write the wrong vault.
  if ! printf '%s' "$health" | grep -q "\"runtime\":\"$runtime\""; then
    echo "privateprompt: port $port is serving a different runtime; run '$0 --stop' first" >&2
    exit 1
  fi
  echo "privateprompt: already running on port $port"
else
  PRIVATEPROMPT_RUNTIME="$runtime" PRIVATEPROMPT_PORT="$port" \
    nohup node "$server" >/dev/null 2>&1 &
  # Poll rather than sleep a fixed amount: usually ready in well under a second.
  for _ in $(seq 1 50); do
    health="$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)"
    [ -n "$health" ] && break
    sleep 0.1
  done
  if [ -z "$health" ]; then
    echo "privateprompt: server did not come up on port $port" >&2
    exit 1
  fi
  echo "privateprompt: started on port $port (runtime: $runtime)"
fi

# Percent-encode the project path so directories with spaces survive the query string.
encoded_dir="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$project_dir")"
url="http://127.0.0.1:$port/?cwd=$encoded_dir"
echo "$url"

if [ "$open_page" -eq 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  else
    echo "privateprompt: open the URL above in your browser"
  fi
fi
