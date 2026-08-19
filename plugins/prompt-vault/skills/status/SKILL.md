---
name: status
description: Report a quick pending/in-progress/done count for this project's Prompt Vault queue, without opening the browser page.
---

# Check the Vault's Status

Answer "what's in the queue?" with a one-line count, for when the user wants a
glance rather than the full list or the browser page.

Start every vault command with this line, which prefers a global install and
falls back to `npx`. Shell state does not survive between tool calls, so repeat
it each time rather than defining it once:

```sh
pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y agent-prompt-vault "$@"; fi; }
```

## Steps

1. Get this project's queue as JSON:

   ```sh
   pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y agent-prompt-vault "$@"; fi; }
   pv list --json
   ```

2. Tally `status` across the returned array — `pending`, `in_progress`, `done`
   — and report one line, e.g. `3 pending, 1 in progress, 12 done`. An empty
   array means the queue is empty for this project; say so.

3. Do not paste prompt text back into chat — this is a count, not a review.
   Point at `/prompt-vault:open` or `pv list` if the user wants the actual
   contents.

## Notes

- Read-only: this never claims, edits, or removes anything.
- `pv peek` shows the next pending prompt(s) without claiming them, if the
  user wants to see what's next rather than just a count.
