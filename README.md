# Prompt Vault

A local prompt queue for coding agents, plus a plugin for Claude Code, Codex,
and Cursor.

Write your prompts into a browser page instead of the chat box. They go into a
SQLite queue outside your repository. Your agent then claims them one at a
time, carries each one out, and marks it done — so the prompt text never has to
appear in the transcript, and you can line up work while the agent is busy.

## Quick start

```bash
npx -y agent-prompt-vault
```

That starts a loopback-only server and opens the queue for the current
directory. Add prompts, then in your agent run `/prompt-vault:next`.

## Docs

- **[Commands](docs/commands.md)** — the full CLI (`add`, `next`, `done`,
  `list`, `peek`, `reset`, `template`) and flags, plus the plugin commands.
  `--help`/`-h` on any command prints this same reference from the CLI itself.
- **[How it works](docs/how-it-works.md)** — the schema, project scoping,
  privacy, and configuration (`PV_DATA_DIR`, `PV_PORT`).
- **[Development](docs/development.md)** — running from source, tests,
  project layout.

## Plugin commands

- **`/prompt-vault:open`** — start the vault and open the queue page.
- **`/prompt-vault:next`** — claim the next queued prompt (or a count, or all of
  them), carry it out, and mark it done.
- **`/prompt-vault:queue-plan`** — split a plan, spec, or task ledger into
  self-contained prompts and load them into the queue.
- **`/prompt-vault:status`** — report a quick pending/in-progress/done count
  for this project's queue, without opening the browser page.

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

The skills only shell out to `npx -y agent-prompt-vault`, the package published from
this repository, so an agent following a skill always resolves the same
published name. The plugin itself is markdown files; there is nothing to
keep in sync between the plugin and the app, and publishing a new version
reaches users without touching the skills.

## Requirements

Node.js 22.5 or newer. The vault uses Node's built-in `node:sqlite`, so it has
no runtime dependencies at all — nothing to compile, nothing to install.

## License

MIT — see [LICENSE](LICENSE).
