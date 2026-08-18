---
name: private-prompt
description: Use when the user invokes /private-prompt, or wants to draft or optionally enhance a prompt in a local browser page before the agent reads the saved file as reference context instead of the prompt appearing in chat.
---

# Private Prompt Vault

## Overview

Use a local browser page to draft a prompt and save it outside the current
project. Do not ask the user to paste its contents into chat. When they say it
is ready, read the saved file and use it as reference context.

The optional **Enhance** action starts a separate agent CLI run and sends the
prompt to the configured model; it is not a local-only transformation. Saved
drafts live in one place for every agent — `~/.private-prompt/` — outside any
repository and stable across plugin updates.

## Steps

1. Confirm `node` is available (the server needs it):
   ```bash
   command -v node >/dev/null || echo "node not found — install Node.js to use private-prompt"
   ```
   If missing, tell the user and stop.

2. Locate the bundled vault and hand off to `vault/start.js`, which
   health-checks, starts if needed, and opens the page in one call. Hosts do not
   export their plugin-root variables into shell calls, so search the install
   locations — this works the same under Claude Code, Codex, Cursor, and a bare
   terminal:
   ```sh
   private_prompt_vault=""
   if [ -n "${PP_PLUGIN_ROOT:-}" ]; then
     private_prompt_vault="$PP_PLUGIN_ROOT/skills/private-prompt/vault"
   else
     private_prompt_found="$(find "$HOME/.claude/plugins" "$HOME/.cursor/plugins" "$HOME/.codex/plugins" "$HOME/.agents" -maxdepth 8 -type f -path '*private-prompt/vault/start.js' 2>/dev/null | sort -r | head -1)"
     [ -n "$private_prompt_found" ] && private_prompt_vault="$(dirname "$private_prompt_found")"
   fi
   if [ ! -f "$private_prompt_vault/start.js" ]; then
     echo "private-prompt vault not found"
     exit 1
   fi
   node "$private_prompt_vault/start.js" --cwd "$(pwd)"
   ```
   `start.js` is pure Node — no bash, `curl`, `nohup`, `pkill`, or `open`
   required — and idempotent: it reuses a server that is already up, polls
   `/health` until ready, and opens the page with the project directory attached
   (so the page shows project and Git-branch context and keeps each project's
   draft separate). It prints the URL — pass that to the user if no browser
   opened. `--no-open` starts without opening; `--stop` stops the server;
   `--port` overrides the port.

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

4. Once the user confirms, read that project's prompt file. The path is fully
   determined by the project directory — one vault for every agent, no runtime
   guessing:
   ```sh
   printf '%s/prompts/%s.md\n' "${PP_DATA_DIR:-$HOME/.private-prompt}" "$(printf %s "$(pwd)" | shasum | cut -c1-12)"
   ```
   That file's content is the actual reference. If it starts with `## Original`
   and `## Enhanced` headings (from **Save both versions**), treat the text under
   `## Enhanced` as the actionable prompt and `## Original` as background only —
   Enhanced is the version the user chose to act on. Otherwise the whole file is
   the prompt. Do not paste its raw text back into chat unless the user asks to
   see it.

## Notes

- One prompt file per project, `~/.private-prompt/prompts/<sha1(cwd)>.md`, so
  concurrent uses from different projects never clobber each other. No `cwd`
  falls back to `prompt.md` in the same directory.
- Every Save also appends a timestamped snapshot to
  `prompts/<sha1(cwd)>.history.jsonl` (capped at the last 50), which the page's
  **History** view lists with Copy / Restore / Delete per entry — a scratch log,
  not a durable archive. Re-saving unchanged text adds no snapshot, and a blank
  save is rejected rather than wiping the prompt file.
- If the user edits Original after enhancing it, the page flags the Enhanced
  draft as stale and asks whether to delete it before saving, so the file never
  pairs a new Original with an Enhanced built from older text.
- The server has no authentication and binds only to `127.0.0.1`. Other
  processes under the same local account can reach it, including its
  `POST /shutdown` route.
- To stop the server: `node vault/start.js --stop`.
- `PP_DATA_DIR` moves the vault, `PP_PORT` changes the port (default `8974`),
  `PP_RUNTIME` (`claude` / `codex` / `cursor`) picks which CLI the Enhance panel
  preselects, and `PP_PLUGIN_ROOT` points at a manually copied install.
