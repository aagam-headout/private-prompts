---
name: privateprompt
description: Use when the user invokes /privateprompt, or wants to draft or optionally enhance a prompt in a local browser page before Codex reads the saved file as reference context instead of the prompt appearing in chat.
---

# Private Prompt Vault

## Overview

Use a local browser page to draft a prompt and save it outside the current
project. Do not ask the user to paste its contents into chat. When they say it
is ready, read the saved file and use it as reference context.

The optional **Enhance** action starts a separate Codex CLI run and sends the
prompt to the configured Codex model; it is not a local-only transformation.
The Codex vault lives in `~/.codex/private-prompts/`, stable across plugin
updates. When Claude Code starts this skill, it uses its own local `claude` CLI
and `~/.claude/private-prompts/` directory instead.

## Steps

1. Confirm `node` is available (the server needs it):
   ```bash
   command -v node >/dev/null || echo "node not found — install Node.js to use privateprompt"
   ```
   If missing, tell the user and stop.

2. Resolve the bundled vault directory and runtime. In Codex, use the installed
   plugin path reported by `codex plugin list`; this avoids the Claude-only
   `${CLAUDE_PLUGIN_ROOT}` variable. `PRIVATEPROMPT_PLUGIN_ROOT` is the override
   for a manually copied installation.
   ```bash
   if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
     privateprompt_root="$CLAUDE_PLUGIN_ROOT"
     privateprompt_runtime="claude"
   elif [ -n "${PRIVATEPROMPT_PLUGIN_ROOT:-}" ]; then
     privateprompt_root="$PRIVATEPROMPT_PLUGIN_ROOT"
     privateprompt_runtime="codex"
   else
     privateprompt_root="$(codex plugin list 2>/dev/null | awk '$1 ~ /^privateprompt@/ { print $NF; exit }')"
     privateprompt_runtime="codex"
   fi
   test -n "$privateprompt_root" && test -f "$privateprompt_root/skills/privateprompt/vault/privateprompt-server.js"
   privateprompt_vault="$privateprompt_root/skills/privateprompt/vault"
   ```

3. Start the loopback-only server. If another runtime already owns the port,
   tell the user to stop it before continuing.
   ```bash
   privateprompt_health="$(curl -fsS http://127.0.0.1:8974/health 2>/dev/null || true)"
   if [ -z "$privateprompt_health" ]; then
     PRIVATEPROMPT_RUNTIME="$privateprompt_runtime" \
       nohup node "$privateprompt_vault/privateprompt-server.js" >/dev/null 2>&1 &
   elif ! printf '%s' "$privateprompt_health" | grep -q "\"runtime\":\"$privateprompt_runtime\""; then
     echo "privateprompt is already running for a different agent runtime; stop it first"
     exit 1
   fi
   ```

4. Open it, passing the current project directory so the page can show project
   and Git-branch context and keep each project's draft separate:
   ```bash
   open "http://127.0.0.1:8974/?cwd=$(pwd)"
   ```
   (Linux: `xdg-open`; if neither exists, give the user the URL.)

5. Tell the user to write or paste the prompt in the page, optionally click
   **Enhance**, then click **Save** (or Cmd/Ctrl+S). In Codex, Enhance is an
   isolated, read-only `codex exec` run and sends the text to the configured
   Codex model. Ask the user to return and say done. If the page says the CLI
   is unavailable, Enhance is unavailable but Save still works.

6. Once the user confirms, read that project's prompt file. The data directory
   depends on which runtime actually served the request — `claude` when
   `$privateprompt_runtime` is `claude`, `codex` otherwise (or whatever
   `PRIVATEPROMPT_DATA_DIR` was overridden to):
   ```bash
   echo -n "$(pwd)" | shasum | cut -c1-12
   ```
   Then read `~/.${privateprompt_runtime}/private-prompts/prompts/<hash>.md`
   (i.e. `~/.claude/...` or `~/.codex/...`). That content is the actual
   reference. Do not paste its raw text back into chat unless the user asks to
   see it.

## Notes

- One prompt file per project (`prompts/<sha1(cwd)>.md`) prevents concurrent
  uses from different projects from overwriting each other. No `cwd` falls back
  to a shared `prompt.md`.
- Every Save also appends a timestamped snapshot to
  `prompts/<sha1(cwd)>.history.jsonl` (capped at the last 50), which the page's
  **History** view lists — this is a scratch log, not a durable archive.
- The server has no authentication and binds only to `127.0.0.1`. Other
  processes under the same local account can still reach it.
- To stop the server: `pkill -f "privateprompt-server.js"`.
- For a manually copied installation, set `PRIVATEPROMPT_PLUGIN_ROOT` to the
  directory containing `.codex-plugin/` and `skills/`.
- `PRIVATEPROMPT_DATA_DIR` and `PRIVATEPROMPT_PORT` override the data directory
  and port the server binds to, if set.
