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

2. Locate the bundled vault directory and hand off to `vault/start.js`, which
   health-checks, starts if needed, and opens the page in one call. Do not rely
   on `CLAUDE_PLUGIN_ROOT` / `CURSOR_PLUGIN_ROOT` inside the command — hosts do
   not export those into shell calls. Search the install locations instead, so
   the same command works under Claude Code, Codex, Cursor, and a bare terminal:
   ```sh
   privateprompt_vault=""
   if [ -n "${PRIVATEPROMPT_PLUGIN_ROOT:-}" ] && [ -f "$PRIVATEPROMPT_PLUGIN_ROOT/skills/privateprompt/vault/start.js" ]; then
     privateprompt_vault="$PRIVATEPROMPT_PLUGIN_ROOT/skills/privateprompt/vault"
   else
     privateprompt_found="$(find "$HOME/.claude/plugins" "$HOME/.cursor/plugins" "$HOME/.codex/plugins" "$HOME/.agents" -maxdepth 8 -type f -name start.js -path '*privateprompt*' 2>/dev/null | sort -r | head -1)"
     [ -n "$privateprompt_found" ] && privateprompt_vault="$(dirname "$privateprompt_found")"
   fi
   if [ -z "$privateprompt_vault" ]; then
     if find "$HOME/.claude/plugins" "$HOME/.cursor/plugins" "$HOME/.codex/plugins" "$HOME/.agents" -maxdepth 8 -type f -name privateprompt-server.js 2>/dev/null | grep -q .; then
       echo "installed privateprompt predates start.js — update the plugin"
     else
       echo "privateprompt plugin files could not be located"
     fi
     exit 1
   fi
   node "$privateprompt_vault/start.js" --cwd "$(pwd)"
   ```
   If the path above resolves to a version older than the one this document came
   from, prefer the directory this skill was loaded from.

   `start.js` is pure Node — no bash, `curl`, `nohup`, `pkill`, or `open`
   required — and idempotent: it reuses a server that is already up, refuses a
   port serving a different agent runtime, polls `/health` until ready, and opens
   the page with the project directory attached (so the page can show project and
   Git-branch context and keep each project's draft separate). It infers the
   runtime from its own install path, or from `PRIVATEPROMPT_RUNTIME` when set.
   It prints the URL — pass that to the user if no browser opened. `--no-open`
   starts without opening; `--stop` stops the server; `--port` overrides the
   port. (`start.sh` is a thin wrapper around it for shell convenience.)

3. Tell the user to write or paste the prompt in the page, optionally click
   **Enhance**, then click **Save** (or Cmd/Ctrl+S). Enhance's CLI picker
   defaults to the current runtime but can be pointed at any installed CLI
   (Claude, Codex, Cursor's `agent`) with its own model dropdown. By default
   Save stores whichever tab (Original or Enhanced) is open; checking
   **Save both versions** instead writes one file with both under
   `## Original` / `## Enhanced` headings, so you see both when you read it
   back. Ask the user to return and say done. The page hides what does not
   apply: the Enhanced tab and **Save both versions** appear only once an
   Enhanced draft exists, the CLI picker only when more than one CLI is
   installed, and the whole Enhance panel disappears when none is.

4. Once the user confirms, resolve and read that project's prompt file. Do not
   guess the runtime directory from `CLAUDE_PLUGIN_ROOT` and friends — those are
   not exported into shell calls. Check every candidate and take the most
   recently written file:
   ```bash
   privateprompt_hash="$(printf %s "$(pwd)" | shasum | cut -c1-12)"
   if [ -n "${PRIVATEPROMPT_DATA_DIR:-}" ]; then
     set -- "$PRIVATEPROMPT_DATA_DIR"   # explicit override wins outright
   else
     set -- "$HOME/.claude/private-prompts" "$HOME/.cursor/private-prompts" "$HOME/.codex/private-prompts"
   fi
   privateprompt_file=""
   for privateprompt_dir in "$@"; do
     privateprompt_candidate="$privateprompt_dir/prompts/${privateprompt_hash}.md"
     [ -s "$privateprompt_candidate" ] || continue
     if [ -z "$privateprompt_file" ] || [ "$privateprompt_candidate" -nt "$privateprompt_file" ]; then
       privateprompt_file="$privateprompt_candidate"
     fi
   done
   test -n "$privateprompt_file" && printf '%s\n' "$privateprompt_file"
   ```
   That file's content is the actual reference. If the file starts with `## Original`
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
- To stop the server: `node vault/start.js --stop` (it asks the server to exit
  over loopback, so no `pkill` or `taskkill` is involved). Any local process
  under this account can call that route, same as `/save`.
- For a manually copied installation, set `PRIVATEPROMPT_PLUGIN_ROOT` to the
  directory containing the plugin manifest and `skills/`. Set
  `PRIVATEPROMPT_RUNTIME` to `cursor`, `claude`, or `codex` when the host does
  not provide its own plugin-root variable.
- `PRIVATEPROMPT_DATA_DIR` and `PRIVATEPROMPT_PORT` override the data directory
  and port the server binds to, if set.
