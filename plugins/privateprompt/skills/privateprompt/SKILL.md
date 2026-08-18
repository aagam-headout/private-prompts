---
name: privateprompt
description: Use when the user invokes /privateprompt, or wants to draft or optionally enhance a prompt in a local browser page before the agent reads the saved file as reference context instead of the prompt appearing in chat.
---

# Private Prompt Vault

## Overview

Use a local browser page to draft a prompt and save it outside the current
project. Do not ask the user to paste its contents into chat. When they say it
is ready, read the saved file and use it as reference context.

The optional **Enhance** action starts a separate agent CLI run and sends the
prompt to the configured model; it is not a local-only transformation. Saved
drafts live in a runtime-specific directory under the home folder
(`~/.codex/private-prompts/`, `~/.claude/private-prompts/`, or
`~/.cursor/private-prompts/`), stable across plugin updates.

## Steps

1. Confirm `node` is available (the server needs it):
   ```bash
   command -v node >/dev/null || echo "node not found — install Node.js to use privateprompt"
   ```
   If missing, tell the user and stop.

2. Resolve the bundled vault directory and start the loopback-only server in
   the **same shell command**. Prefer each host's plugin-root variable when set:
   `${CURSOR_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`, or the installed Codex
   path from `codex plugin list`. `PRIVATEPROMPT_PLUGIN_ROOT` is the override for
   a manually copied installation; pair it with `PRIVATEPROMPT_RUNTIME` when
   needed. If another runtime owns the port, tell the user to stop it.
   ```bash
   if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
     privateprompt_root="$CURSOR_PLUGIN_ROOT"
     privateprompt_runtime="cursor"
   elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
     privateprompt_root="$CLAUDE_PLUGIN_ROOT"
     privateprompt_runtime="claude"
   elif [ -n "${PRIVATEPROMPT_PLUGIN_ROOT:-}" ]; then
     privateprompt_root="$PRIVATEPROMPT_PLUGIN_ROOT"
     privateprompt_runtime="${PRIVATEPROMPT_RUNTIME:-codex}"
   else
     privateprompt_root="$(codex plugin list 2>/dev/null | awk '$1 ~ /^privateprompt@/ { print $NF; exit }')"
     privateprompt_runtime="codex"
   fi
   if [ -z "$privateprompt_root" ] || [ ! -f "$privateprompt_root/skills/privateprompt/vault/privateprompt-server.js" ]; then
     echo "privateprompt plugin files could not be located"
     exit 1
   fi
   privateprompt_vault="$privateprompt_root/skills/privateprompt/vault"
   privateprompt_port="${PRIVATEPROMPT_PORT:-8974}"
   privateprompt_health="$(curl -fsS "http://127.0.0.1:$privateprompt_port/health" 2>/dev/null || true)"
   if [ -z "$privateprompt_health" ]; then
     PRIVATEPROMPT_RUNTIME="$privateprompt_runtime" \
       PRIVATEPROMPT_PORT="$privateprompt_port" \
       nohup node "$privateprompt_vault/privateprompt-server.js" >/dev/null 2>&1 &
   elif ! printf '%s' "$privateprompt_health" | grep -q "\"runtime\":\"$privateprompt_runtime\""; then
     echo "privateprompt is already running for a different agent runtime; stop it first"
     exit 1
   fi
   ```

3. Open it, passing the current project directory so the page can show project
   and Git-branch context and keep each project's draft separate:
   ```bash
   open "http://127.0.0.1:${PRIVATEPROMPT_PORT:-8974}/?cwd=$(pwd)"
   ```
   (Linux: `xdg-open`; if neither exists, give the user the URL.)

4. Tell the user to write or paste the prompt in the page, optionally click
   **Enhance**, then click **Save** (or Cmd/Ctrl+S). Enhance's CLI picker
   defaults to the current runtime but can be pointed at any installed CLI
   (Claude, Codex, Cursor's `agent`) with its own model dropdown. By default
   Save stores whichever tab (Original or Enhanced) is open; checking
   **Save both versions** instead writes one file with both under
   `## Original` / `## Enhanced` headings, so you see both when you read it
   back. Ask the user to return and say done. If the page says a CLI is
   unavailable, Enhance is disabled for that CLI but Save still works.

5. Once the user confirms, read that project's prompt file. Use
   `~/.codex/private-prompts/prompts/<hash>.md` for Codex,
   `~/.claude/private-prompts/prompts/<hash>.md` for Claude Code, and
   `~/.cursor/private-prompts/prompts/<hash>.md` for Cursor. If
   `PRIVATEPROMPT_DATA_DIR` was used to override storage, use that location
   instead:
   ```bash
   echo -n "$(pwd)" | shasum | cut -c1-12
   ```
   That content is the actual reference. If the file starts with `## Original`
   and `## Enhanced` headings (from **Save both versions**), treat the text
   under `## Enhanced` as the actionable prompt and `## Original` as
   background only — Enhanced is the version the user chose to act on.
   Otherwise the whole file is the prompt. Do not paste its raw text back into
   chat unless the user asks to see it.

## Notes

- One prompt file per project (`prompts/<sha1(cwd)>.md`) prevents concurrent
  uses from different projects from overwriting each other. No `cwd` falls back
  to a shared `prompt.md`.
- Every Save also appends a timestamped snapshot to
  `prompts/<sha1(cwd)>.history.jsonl` (capped at the last 50), which the page's
  **History** view lists with Copy / Restore / Delete per entry — this is a
  scratch log, not a durable archive. Re-saving unchanged text adds no snapshot,
  and a blank save is rejected rather than wiping the prompt file.
- If the user edits Original after enhancing it, the page flags the Enhanced
  draft as stale and asks whether to delete it before saving, so the file never
  pairs a new Original with an Enhanced built from older text.
- The server has no authentication and binds only to `127.0.0.1`. Other
  processes under the same local account can still reach it.
- To stop the server: `pkill -f "privateprompt-server.js"`.
- For a manually copied installation, set `PRIVATEPROMPT_PLUGIN_ROOT` to the
  directory containing the plugin manifest and `skills/`. Set
  `PRIVATEPROMPT_RUNTIME` to `cursor`, `claude`, or `codex` when the host does
  not provide its own plugin-root variable.
- `PRIVATEPROMPT_DATA_DIR` and `PRIVATEPROMPT_PORT` override the data directory
  and port the server binds to, if set.
