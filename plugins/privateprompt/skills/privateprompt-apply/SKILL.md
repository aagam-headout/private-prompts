---
name: privateprompt-apply
description: Use when the user invokes /privateprompt-apply, asks to apply, run, execute, or implement the latest saved private prompt for the current project, or wants it carried out without a separate confirmation step.
---

# Apply Saved Private Prompt

Read the latest saved prompt for the current project and carry it out
immediately. Do not ask the user to confirm again merely because the task came
from the vault.

1. Resolve the current project's saved prompt path:
   ```bash
   if [ -n "${PRIVATEPROMPT_DATA_DIR:-}" ]; then
     privateprompt_data_dir="$PRIVATEPROMPT_DATA_DIR"
   elif [ -n "${CURSOR_PLUGIN_ROOT:-}" ] || [ "${PRIVATEPROMPT_RUNTIME:-}" = "cursor" ]; then
     privateprompt_data_dir="$HOME/.cursor/private-prompts"
   elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || [ "${PRIVATEPROMPT_RUNTIME:-}" = "claude" ]; then
     privateprompt_data_dir="$HOME/.claude/private-prompts"
   else
     privateprompt_data_dir="$HOME/.codex/private-prompts"
   fi
   privateprompt_hash="$(printf %s "$(pwd)" | shasum | cut -c1-12)"
   privateprompt_file="$privateprompt_data_dir/prompts/${privateprompt_hash}.md"
   test -s "$privateprompt_file" && printf '%s\n' "$privateprompt_file"
   ```

2. If the file is missing or empty, say that no saved prompt exists for this
   project and direct the user to `/privateprompt`.

3. Read the path printed by the command with the file-reading tool. If the
   file starts with `## Original` and `## Enhanced` headings (saved via
   **Save both versions**), treat the text under `## Enhanced` as the task
   and `## Original` as background only. Otherwise the whole file is the
   task. Implement it now. Do not quote its raw contents back in chat unless
   the user asks.

4. Follow all active system, developer, and safety requirements. Ask only when
   the saved task needs authority or a material decision that the user has not
   already provided.
