---
name: next
description: Claim the next queued prompt or prompts for this project from the Prompt Vault, carry them out, and mark each one done.
---

# Run the Next Queued Prompt

Claim queued prompts for the current project and carry them out immediately. Do
not ask the user to confirm again merely because the task came from the vault.

## Steps

1. Claim work. The default is one prompt; pass a count or `--all` when the user
   asked for more. Claiming is atomic — it flips each prompt to `in_progress` so
   a second agent cannot pick up the same one.

   ```sh
   npx -y prompt-vault next --cwd "$(pwd)"          # the next one
   npx -y prompt-vault next 2 --cwd "$(pwd)"        # the next two
   npx -y prompt-vault next --all --cwd "$(pwd)"    # everything pending
   ```

2. If it reports no pending prompts, say so and point the user at
   `/prompt-vault:open`. Stop there.

3. Otherwise the output holds one block per claimed prompt:

   ```text
   === prompt 7 ===
   <the prompt text>
   ```

   Each block's text is the task. Work through them in the order printed. Do not
   quote the raw text back into chat unless the user asks to see it.

4. Mark each prompt done as you finish it — not all at once at the end, so an
   interrupted run leaves accurate state behind:

   ```sh
   npx -y prompt-vault done 7
   ```

5. Follow all active system, developer, and safety requirements. Ask only when a
   queued task needs authority or a material decision the user has not already
   given. If you cannot complete one, leave it `in_progress`, say which id
   stalled and why, and move on rather than marking it done.

## Notes

- `next` and `done` read and write the database directly, so they work whether
  or not the browser vault is running.
- A prompt left `in_progress` by a failed run can be put back with the
  **Requeue** button in the page, or picked up again after the user resets it.
- `npx -y prompt-vault list --cwd "$(pwd)"` shows the current queue and each
  prompt's id and status.
