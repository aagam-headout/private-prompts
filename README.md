# Private Prompt Vault

A plugin for Codex, Claude Code, and Cursor. Draft a prompt in a local browser
page, save it outside your repository, then let your agent read the saved file
as reference — the prompt itself never has to appear in the chat transcript.

## Commands

- **`/privateprompt`** — open the vault page to draft, optionally enhance,
  and save a prompt.
- **`/privateprompt-apply`** — read the current project's latest saved
  prompt and carry it out immediately, no re-confirmation.

## How it works

1. `/privateprompt` starts a local, loopback-only server and opens it in
   your browser.
2. Write or paste a prompt, optionally **Enhance** it (pick any installed
   CLI/model — defaults to the current runtime), then **Save**. Save keeps
   whichever tab is open; check **Save both versions** to keep Original and
   Enhanced together in one file.
3. The agent reads that file as reference context instead of you pasting it
   into chat. If the file holds both versions, Enhanced is the task and
   Original is background only.
4. `/privateprompt-apply` does step 3 without asking first.

Drafts live per-project (keyed by a hash of the working directory) under a
per-runtime home directory (`~/.codex/`, `~/.claude/`, or
`~/.cursor/private-prompts/`), and every save keeps up to 50 timestamped
history snapshots in the page's **History** tab, each with **Copy**,
**Restore**, and **Delete**.

Editing Original after an Enhance run marks the Enhanced draft stale and asks
whether to delete it, so a leftover Enhanced version never rides along with a
prompt it was not generated from.

## Install

### Codex

```bash
codex plugin marketplace add aagam-headout/private-prompts
codex plugin add privateprompt@privateprompt
```

After an update:

```bash
codex plugin marketplace upgrade privateprompt
codex plugin add privateprompt@privateprompt
```

### Claude Code

```text
/plugin marketplace add aagam-headout/private-prompts
/plugin install privateprompt
```

### Cursor

1. Open **Cursor Settings**, search plugins section.
2. Browse marketplace, add marketplace, add this repo
   (`aagam-headout/private-prompts`).
3. Plugin shows up there — add it. Applies to your Cursor.

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
