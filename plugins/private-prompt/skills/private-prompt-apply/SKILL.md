---
name: private-prompt-apply
description: Use when the user invokes /private-prompt-apply, asks to apply, run, execute, or implement the latest saved private prompt for the current project, or wants it carried out without a separate confirmation step.
---

# Apply Saved Private Prompt

Read the latest saved prompt for the current project and carry it out
immediately. Do not ask the user to confirm again merely because the task came
from the vault.

1. Resolve the current project's saved prompt path. It is fully determined by
   the project directory — one vault for every agent, no runtime guessing:
   ```sh
   # pwd -P matches the symlink-resolved path the server hashes; sha1sum covers
   # systems without shasum.
   private_prompt_sha() { if command -v shasum >/dev/null 2>&1; then shasum; else sha1sum; fi; }
   private_prompt_file="${PP_DATA_DIR:-$HOME/.private-prompt}/prompts/$(printf %s "$(pwd -P)" | private_prompt_sha | cut -c1-12).md"
   test -s "$private_prompt_file" && printf '%s\n' "$private_prompt_file"
   ```

2. If the file is missing or empty, say that no saved prompt exists for this
   project and direct the user to `/private-prompt`.

3. Read the path printed by the command with the file-reading tool. If the
   file starts with `## Original` and `## Enhanced` headings (saved via
   **Save both versions**), treat the text under `## Enhanced` as the task
   and `## Original` as background only. Otherwise the whole file is the
   task. Implement it now. Do not quote its raw contents back in chat unless
   the user asks.

4. Follow all active system, developer, and safety requirements. Ask only when
   the saved task needs authority or a material decision that the user has not
   already provided.
