# Private Prompt Vault

A plugin for Codex, Claude Code, and Cursor. Draft a prompt in a local browser
page, save it outside your repository, then let your agent read the saved file
as reference — the prompt itself never has to appear in the chat transcript.

## Plugins and skills, briefly

If these terms are new: a **plugin** is an installable bundle an agent CLI
(Codex, Claude Code, Cursor) loads — it can add slash commands, background
servers, or files the agent knows how to use. A **skill** is one instruction
set inside that bundle: a markdown file (`SKILL.md`) telling the agent *when*
to act (its trigger, e.g. "user runs `/privateprompt`") and *what steps to run*
when it does. This repo ships one plugin, `privateprompt`, with two skills:

- **`privateprompt`** — opens the vault page so you can draft, optionally
  enhance, and save a prompt.
- **`privateprompt-apply`** — reads the current project's latest saved prompt
  and carries it out immediately, no re-confirmation needed.

Each skill runs as a slash command (`/privateprompt`, `/privateprompt-apply`)
in whichever agent CLI has the plugin installed.

## How it works

1. `/privateprompt` starts a small local server (Node, loopback-only) and
   opens it in your browser.
2. You write or paste a prompt, optionally click **Enhance** (sends the draft
   to a CLI/model of your choice to be improved — defaults to the current
   runtime, but the page lets you switch to any other installed CLI and its
   models), then **Save**. Save normally keeps whichever tab is open; check
   **Save both versions** to write Original and Enhanced into one file.
3. The agent reads the saved file directly from disk as reference context —
   you never have to paste it into the chat. **What gets acted on:** if the
   file holds both versions, the agent treats Enhanced as the actual task and
   Original as background only; a single-version save is used as-is.
4. `/privateprompt-apply` skips step 3's confirmation: it reads the latest
   saved prompt for the current project and executes it right away, applying
   the same Enhanced-over-Original rule.

Storage is per-project (keyed by a hash of the working directory) and
per-runtime home directory (`~/.codex/`, `~/.claude/`, or
`~/.cursor/private-prompts/`), so drafts survive plugin updates and don't
collide across projects or agents. Every save also keeps up to 50 timestamped
history snapshots, browsable from the page's **History** tab.

## Install

### Codex

```bash
codex plugin marketplace add aagam-headout/private-propmts
codex plugin add privateprompt@privateprompt
```

After an update:

```bash
codex plugin marketplace upgrade privateprompt
codex plugin add privateprompt@privateprompt
```

### Claude Code

```text
/plugin marketplace add aagam-headout/private-propmts
/plugin install privateprompt
```

### Cursor

Install from the GitHub marketplace source in **Cursor Settings → Plugins**, or
submit the repo at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

The repo ships `.cursor-plugin/marketplace.json` at the root and
`plugins/privateprompt/.cursor-plugin/plugin.json` for the plugin bundle.

For a manual installation in any of the three, copy `plugins/privateprompt/`
to the host's plugin location and set:

```bash
export PRIVATEPROMPT_PLUGIN_ROOT=/path/to/privateprompt
export PRIVATEPROMPT_RUNTIME=cursor   # or claude / codex
```

## Privacy

The page and saved files are local and outside the current project. However,
when an agent reads a saved draft or you click **Enhance**, its content is
sent to the configured agent CLI/model provider. The unauthenticated server is
limited to `127.0.0.1`, so other processes under the same local account can
access it while it is running.

## Requirements

- Recent Node.js
- `codex` on `PATH` for Codex Enhance
- `claude` on `PATH` for Claude Code Enhance
- `agent` on `PATH` for Cursor Enhance

## Configuration

Environment variables, all optional:

- `PRIVATEPROMPT_PLUGIN_ROOT` — override the plugin directory for a manually
  copied installation (directory containing the plugin manifest and `skills/`).
- `PRIVATEPROMPT_RUNTIME` — force `codex`, `claude`, or `cursor` when the host
  doesn't expose its own plugin-root variable.
- `PRIVATEPROMPT_DATA_DIR` — override where drafts and history are stored.
- `PRIVATEPROMPT_PORT` — override the port the local server binds to
  (default `8974`).

To stop the server manually: `pkill -f "privateprompt-server.js"`.

## License

MIT — see [LICENSE](LICENSE).
