---
name: next
description: Claim the next queued prompt or prompts for this project from the Prompt Vault, carry them out, and mark each one done.
---

# Run the Next Queued Prompt

Carry out queued prompts for this project immediately. Do not ask the user to
confirm again merely because the task came from the vault.

Start every vault command with this line, which prefers a global install and
falls back to `npx`. Shell state does not survive between tool calls, so repeat
it each time rather than defining it once:

```sh
pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y prompt-vault-cli "$@"; fi; }
```

## Steps

1. Claim. One prompt by default; `pv next 2` or `pv next --all` when the user
   asked for more. Claiming is atomic, so a second agent cannot take the same
   prompt.

   ```sh
   pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y prompt-vault-cli "$@"; fi; }
   pv next
   ```

   Nothing pending: say so, point at `/prompt-vault:open`, stop.

2. Each `=== prompt <id> ===` block is one task. Work through them in the order
   printed. Do not quote the text back into chat unless asked.

3. Mark each one done as you finish it, not all at the end, so an interrupted run
   leaves accurate state: `pv done 7` (or `pv done 7 8 9`).

4. Cannot finish one? Hand it back rather than leaving it claimed — a claimed
   prompt is invisible to the next run. Say which id stalled and why:
   `pv reset 7`.

## Notes

- Commands read the database directly; the browser page need not be running.
- Run from anywhere in the repository — a subdirectory shares the root's queue.
- `done` and `reset` refuse another project's id unless given `--force`.
- `pv list` shows ids and statuses; bare `pv reset` returns every claimed prompt
  in this project.
