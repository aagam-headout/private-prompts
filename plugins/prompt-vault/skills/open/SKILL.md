---
name: open
description: Open the Prompt Vault queue in a local browser page so the user can queue prompts for this project without pasting them into chat.
---

# Open the Prompt Vault

The user writes prompts into a local browser page instead of the chat box;
`/prompt-vault:next` claims them later, so the prompt text never enters the
transcript.

## Steps

1. Start the vault and open the page. Idempotent: it reuses a running server, and
   refuses a port held by a different vault rather than queueing prompts this
   agent will not read. It reports the problem itself if Node is too old.

   ```sh
   pv() { if command -v agent-prompt-vault >/dev/null 2>&1; then agent-prompt-vault "$@"; else npx -y agent-prompt-vault "$@"; fi; }
   pv
   ```

   That definition prefers a global install and falls back to `npx`; repeat it on
   every vault command, since shell state does not survive between tool calls.

2. It prints the URL. If no browser opened, hand the user that URL.

3. Ask the user to add prompts in the page and say when they are ready — never to
   paste prompt text into chat.

4. On their go-ahead, run `/prompt-vault:next`.

## Notes

- Prompts are tagged by project: the page can show every project, while `next`
  claims only this one's. Any directory in the repository resolves to one queue.
- `pv list` answers "what's queued?" without opening the page. `pv --no-open`
  starts without a browser, `pv --stop` stops the server.
- `npm install -g agent-prompt-vault` skips the `npx` fetch on every call.
