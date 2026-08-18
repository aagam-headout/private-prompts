# Prompt Vault

A local prompt queue for coding agents, plus a plugin for Claude Code, Codex,
and Cursor.

Write your prompts into a browser page instead of the chat box. They go into a
SQLite queue outside your repository. Your agent then claims them one at a
time, carries each one out, and marks it done — so the prompt text never has to
appear in the transcript, and you can line up work while the agent is busy.

## Quick start

```bash
npx -y @aagam-headout/prompt-vault
```

That starts a loopback-only server and opens the queue for the current
directory. Add prompts, then in your agent run `/prompt-vault:next`.

## Commands

The CLI is the whole interface. `next`, `done`, and `list` read and write the
database directly, so they work whether or not the browser page is running.

Install it once so the commands below are short:

```bash
npm install -g @aagam-headout/prompt-vault
```

```bash
prompt-vault                  # start the vault (if needed) and open it
prompt-vault --no-open        # start only, print the URL
prompt-vault --stop           # stop the running vault

prompt-vault next             # claim the next pending prompt
prompt-vault next 2           # claim the next two
prompt-vault next --all       # claim everything pending
prompt-vault done 7           # mark prompt 7 done
prompt-vault list             # show this project's queue
```

Flags: `--cwd <path>` (defaults to the current directory), `--port <n>`,
`--json` for machine-readable output on the queue commands.

## Plugin commands

- **`/prompt-vault:open`** — start the vault and open the queue page.
- **`/prompt-vault:next`** — claim the next queued prompt (or a count, or all of
  them), carry it out, and mark it done.

### Install

#### Claude Code

```text
/plugin marketplace add aagam-headout/prompt-vault
/plugin install prompt-vault
```

#### Codex

```bash
codex plugin marketplace add aagam-headout/prompt-vault
codex plugin add prompt-vault@prompt-vault
```

After an update:

```bash
codex plugin marketplace upgrade prompt-vault
codex plugin add prompt-vault@prompt-vault
```

#### Cursor

Open **Cursor Settings**, find the plugins section, add this repo
(`aagam-headout/prompt-vault`) as a marketplace, then add the plugin.

The skills only shell out to `npx -y @aagam-headout/prompt-vault` — a scoped
name, so an agent following a skill can only ever resolve a package published
under this account, never an unowned name someone else controls. The plugin
itself is two markdown files; there is nothing to keep in sync between the
plugin and the app, and publishing a new version reaches users without touching
the skills.

## How it works

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

## Privacy

The page and the database are local and outside the current project. The server
binds to `127.0.0.1` only and refuses requests whose `Host` isn't loopback or
whose `Origin` is another site, so a site you happen to have open can't read or
write your queue by DNS rebinding. Beyond that it is unauthenticated: any
process under your own account can reach it while it runs, as it can already
read the database file directly.

Queued prompts are sent to your agent's model provider at the moment the agent
claims and acts on them — the same as if you had typed them into chat.

## Requirements

Node.js 22.5 or newer. The vault uses Node's built-in `node:sqlite`, so it has
no runtime dependencies at all — nothing to compile, nothing to install.

## Configuration

- `PV_DATA_DIR` — move the vault (default `~/.prompt-vault`).
- `PV_PORT` — port the local server binds to (default `8974`).

## Development

```bash
npm install
npm start          # API + built UI on :8974
npm run dev        # Vite dev server with hot reload, proxying /api to :8974
npm run build      # rebuild dist/
```

The UI is built with Vite (React, Tailwind, shadcn/ui) and Geist is bundled
locally, so a running vault makes no external network requests.

`dist/` is **not** in git — the CLI resolves from the npm registry, so the built
UI only has to exist in the tarball, not in the repository. The
`prepack` script rebuilds it automatically on `npm pack` and `npm publish`,
which also makes it impossible to publish a stale bundle.

## License

MIT — see [LICENSE](LICENSE).
