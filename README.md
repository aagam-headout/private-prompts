# Private Prompt Vault

A plugin for Codex, Claude Code, and Cursor. Draft a prompt in a local browser
page, save it outside your repository, then let your agent read the saved file
as reference — the prompt itself never has to appear in the chat transcript.

## Commands

- **`/private-prompt`** — open the vault page to draft, optionally enhance,
  and save a prompt.
- **`/private-prompt-apply`** — read the current project's latest saved
  prompt and carry it out immediately, no re-confirmation.

## How it works

1. `/private-prompt` starts a local, loopback-only server and opens it in
   your browser.
2. Write or paste a prompt, optionally **Enhance** it (pick any installed
   CLI and model), then **Save**. Save keeps
   whichever tab is open; check **Save both versions** to keep Original and
   Enhanced together in one file.
3. The agent reads that file as reference context instead of you pasting it
   into chat. If the file holds both versions, Enhanced is the task and
   Original is background only.
4. `/private-prompt-apply` does step 3 without asking first.

Drafts live in one vault for every agent — `~/.private-prompt/prompts/<sha1 of
the project directory>.md` — so the path a skill reads is fully determined by the
project you are in. Every save also keeps up to 50 timestamped history snapshots,
listed in the page's **History** tab with **Copy**, **Restore**, and **Delete**.

Editing Original after an Enhance run marks the Enhanced draft stale and asks
whether to delete it, so a leftover Enhanced version never rides along with a
prompt it was not generated from.

## Install

### Codex

```bash
codex plugin marketplace add aagam-headout/private-prompts
codex plugin add private-prompt@private-prompt
```

After an update:

```bash
codex plugin marketplace upgrade private-prompt
codex plugin add private-prompt@private-prompt
```

### Claude Code

```text
/plugin marketplace add aagam-headout/private-prompts
/plugin install private-prompt
```

### Cursor

1. Open **Cursor Settings**, search plugins section.
2. Browse marketplace, add marketplace, add this repo
   (`aagam-headout/private-prompts`).
3. Plugin shows up there — add it. Applies to your Cursor.

The repo ships `.cursor-plugin/marketplace.json` at the root and
`plugins/private-prompt/.cursor-plugin/plugin.json` for the plugin bundle.

For a manual installation in any of the three, copy `plugins/private-prompt/`
to the host's plugin location and set:

```bash
export PP_PLUGIN_ROOT=/path/to/private-prompt
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

- `PP_DATA_DIR` — move the vault (default `~/.private-prompt`).
- `PP_PORT` — port the local server binds to (default `8974`).
- `PP_RUNTIME` — `claude`, `codex`, or `cursor`: which CLI the Enhance panel
  preselects. It does not affect where anything is stored.
- `PP_PLUGIN_ROOT` — path to a manually copied plugin directory (the one
  containing the manifests and `skills/`).

## Running it yourself

`/private-prompt` handles this for you, but the vault is one command on its own —
it health-checks, starts only if nothing is listening, waits for the port, and
opens the page:

```bash
node <plugin-root>/skills/private-prompt/vault/start.js            # start (if needed) + open
node <plugin-root>/skills/private-prompt/vault/start.js --cwd /path/to/project
node <plugin-root>/skills/private-prompt/vault/start.js --no-open  # just print the URL
node <plugin-root>/skills/private-prompt/vault/start.js --stop
```

The launcher is pure Node — no bash, `curl`, `nohup`, `pkill`, or `open` — so it
behaves the same under Claude Code, Codex, Cursor, or a plain terminal, on macOS,
Linux, and Windows. Re-running it is safe: an already-running server is reused.

## License

MIT — see [LICENSE](LICENSE).
