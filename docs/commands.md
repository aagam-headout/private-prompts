# Commands

The CLI is the whole interface. `next`, `done`, `list`, and `peek` read and
write the database directly, so they work whether or not the browser page is
running.

Install it once so the commands below are short:

```bash
npm install -g agent-prompt-vault
```

```bash
prompt-vault                  # start the vault (if needed) and open it
prompt-vault --no-open        # start only, print the URL
prompt-vault --stop           # stop the running vault

prompt-vault add "text"                # queue a new prompt
prompt-vault add < file.txt            # queue a prompt read from stdin
prompt-vault add --each-line < tasks.txt  # queue one prompt per line
prompt-vault next             # claim the next pending prompt
prompt-vault next 2           # claim the next two
prompt-vault next --all       # claim everything pending
prompt-vault done 7           # mark prompt 7 done
prompt-vault done 7 8 9       # mark several done
prompt-vault reset 7          # hand prompt 7 back to the queue
prompt-vault reset            # hand back every claimed prompt in this project
prompt-vault list             # show this project's queue
prompt-vault list --pending-only      # show only pending prompts
prompt-vault list --status done       # filter by status explicitly
prompt-vault peek             # show the next pending prompt, without claiming it
prompt-vault peek 3           # show the next three, without claiming them

prompt-vault template save refactor "text"  # save a reusable prompt skeleton
prompt-vault template list                  # list saved skeletons
prompt-vault template show refactor         # print a saved skeleton
prompt-vault template remove refactor       # delete a saved skeleton
prompt-vault add --template refactor        # queue a skeleton (optionally + extra text)
```

Flags: `--cwd <path>` (defaults to the current directory), `--port <n>`,
`--json` for machine-readable output on the queue commands, `--force` to let
`done` or `reset` touch a prompt belonging to another project, `--status
<pending|in_progress|done>` and `--pending-only` to filter `list`, `--template
<name>` to queue a saved skeleton with `add`.

Templates are plain text files under `$PV_DATA_DIR/templates/`, not database
rows — edit them by hand if you'd rather not use `template save`.

A working directory inside a git repository is tagged with the repository root,
so a prompt queued from the root is claimed by an agent running in `src/` — one
queue per project, not per directory. Queues that were already keyed to a
subdirectory keep working as they are.

## Plugin commands

- **`/prompt-vault:open`** — start the vault and open the queue page.
- **`/prompt-vault:next`** — claim the next queued prompt (or a count, or all of
  them), carry it out, and mark it done.
- **`/prompt-vault:queue-plan`** — split a plan, spec, or task ledger into
  self-contained prompts and load them into the queue.
- **`/prompt-vault:status`** — report a quick pending/in-progress/done count
  for this project's queue, without opening the browser page.

See the [README](../README.md) for installing the plugin in Claude Code,
Codex, or Cursor.
