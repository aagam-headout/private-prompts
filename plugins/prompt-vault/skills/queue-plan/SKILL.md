---
name: queue-plan
description: Break a task, plan, or ledger into self-contained steps and load them into the Prompt Vault queue for this project, so the work proceeds one prompt at a time via /prompt-vault:next.
---

# Queue a Plan Into the Vault

Turn a plan, spec, TODO list, or the user's own task ledger into queued vault
prompts, instead of working through the list in this conversation. Later
`/prompt-vault:next` runs — possibly a different session — claim them one at a
time.

Start every vault command with this line, which prefers a global install and
falls back to `npx`. Shell state does not survive between tool calls, so repeat
it each time rather than defining it once:

```sh
pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y agent-prompt-vault "$@"; fi; }
```

## Steps

1. Get the source list: a plan document, a spec's task section, a TODO file, or
   a breakdown the user just described. If asked to break a task down first,
   do that before queueing — this skill queues a breakdown, it does not invent
   one from a one-line request without confirming the split with the user.

2. Turn each step into one **self-contained** prompt: enough context (file
   paths, the goal, any constraint) that it makes sense read alone with no
   memory of this conversation, since whichever agent claims it later starts
   cold. Vague fragments like "fix the bug" or "part 2" do not survive that.

3. Queue them:
   - If every prompt is a single line, one shot:
     ```sh
     pv() { if command -v prompt-vault >/dev/null 2>&1; then prompt-vault "$@"; else npx -y agent-prompt-vault "$@"; fi; }
     printf '%s\n' "step one, self-contained" "step two, self-contained" | pv add --each-line
     ```
   - If any step needs multiple lines, queue that one on its own instead of
     folding it into `--each-line` (which splits strictly on newlines):
     ```sh
     pv add "longer step with
     multiple lines of detail"
     ```

4. Confirm what landed: `pv list`. Report the queued ids and count back to the
   user — do not paste the full prompt text back into chat.

5. Point at `/prompt-vault:next` to start working through them, unless the user
   said they'll trigger it themselves (e.g. from another session).

## Notes

- One prompt per unit of independent work — not one prompt for the whole plan.
  A single giant prompt defeats the point of a queue: nothing can be claimed,
  finished, or reset independently.
- Order matters: `pv add` and `--each-line` both append to the end of the
  queue in the order given, so list steps in the order they should run.
- This queue is the project's ledger going forward — `pv list` at any point
  shows exactly what's pending, in progress, and done.
