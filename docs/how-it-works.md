# How it works

Every prompt is one row in `~/.prompt-vault/vault.db`, tagged with the absolute
project directory it was queued from:

| column | meaning |
| --- | --- |
| `id` | the number you pass to `done` |
| `project` | absolute path, symlink-resolved |
| `text` | the prompt |
| `status` | `pending` → `in_progress` → `done` |
| `created_at`, `done_at` | timestamps |

The queue is global but project-scoped in use: the page can show every project
at once, while `next` only ever claims prompts belonging to the directory it
was run in. Claiming happens inside a transaction, so two agents — or one agent
run twice — can never pick up the same prompt.

Done rows stay in the table. That is the history; there is no separate archive.

Templates (`agent-prompt-vault template ...`) are separate from all of this — plain
`.txt` files under `$PV_DATA_DIR/templates/`, not database rows. See
[Commands](commands.md).

## Privacy

The page and the database are local and outside the current project. The server
binds to `127.0.0.1` only and refuses requests whose `Host` isn't loopback or
whose `Origin` is another site, so a site you happen to have open can't read or
write your queue by DNS rebinding. Beyond that it is unauthenticated: any
process under your own account can reach it while it runs, as it can already
read the database file directly.

Queued prompts are sent to your agent's model provider at the moment the agent
claims and acts on them — the same as if you had typed them into chat.

## Configuration

- `PV_DATA_DIR` — move the vault (default `~/.prompt-vault`).
- `PV_PORT` — port the local server binds to (default `8974`).
