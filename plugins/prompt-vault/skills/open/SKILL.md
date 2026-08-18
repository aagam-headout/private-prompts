---
name: open
description: Open the Prompt Vault queue in a local browser page so the user can queue prompts for this project without pasting them into chat.
---

# Open the Prompt Vault

## Overview

Prompt Vault is a local queue. The user writes prompts in a browser page; this
agent claims them later with `/prompt-vault:next` and marks each one done. The
prompt text never has to appear in the chat transcript.

Everything lives in one SQLite database outside any repository —
`~/.prompt-vault/vault.db` — shared by every agent and stable across updates.

## Steps

1. Confirm Node.js 22.5 or newer is available (the vault uses Node's built-in
   SQLite):

   ```sh
   node -e 'process.exit(process.versions.node.split(".").map(Number)[0] >= 22 ? 0 : 1)' \
     || echo "prompt-vault needs Node.js 22.5 or newer"
   ```

   If it is missing or too old, tell the user and stop.

2. Start the vault and open it. This is idempotent: it reuses a server that is
   already running, and refuses a port held by a different vault install rather
   than queueing prompts where this agent will not read them.

   ```sh
   npx -y prompt-vault --cwd "$(pwd)"
   ```

   It prints the URL. If no browser opened, give that URL to the user.

3. Tell the user to add their prompts in the page and say when they are ready.
   Do not ask them to paste the prompt text into chat.

4. When they confirm, run `/prompt-vault:next` to claim and carry out the queue.

## Notes

- The queue is global but tagged by project directory: the page can show every
  project, while `next` only ever claims prompts belonging to the current one.
- `npx -y prompt-vault --no-open` starts without opening a browser;
  `--stop` stops the server; `--port` overrides the port.
- `npx -y prompt-vault list` prints this project's queue as a table, which is
  usually enough to answer "what's queued?" without opening the page.
- The server binds only to `127.0.0.1` and rejects any request whose `Host` is
  not loopback or whose `Origin` is another site, so a page the user happens to
  be browsing cannot read or write the queue. There is no authentication beyond
  that: other processes under the same local account can reach every route, as
  they can already read the database file directly.
- `PV_DATA_DIR` moves the vault (default `~/.prompt-vault`), `PV_PORT` changes
  the port (default `8974`).
