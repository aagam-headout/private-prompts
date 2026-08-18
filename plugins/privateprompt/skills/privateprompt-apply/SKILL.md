---
name: privateprompt-apply
description: Use when the user invokes /privateprompt-apply, asks to apply, run, execute, or implement the latest saved private prompt for the current project, or wants it carried out without a separate confirmation step.
---

# Apply Saved Private Prompt

Read the latest saved prompt for the current project and carry it out
immediately. Do not ask the user to confirm again merely because the task came
from the vault.

1. Resolve the current project's saved prompt path. Plugin-root variables like
   `CLAUDE_PLUGIN_ROOT` are not exported into shell calls, so they cannot say
   which runtime saved the prompt — check every candidate directory and take the
   most recently written file, which is by definition the latest save:
   ```bash
   privateprompt_hash="$(printf %s "$(pwd)" | shasum | cut -c1-12)"
   if [ -n "${PRIVATEPROMPT_DATA_DIR:-}" ]; then
     set -- "$PRIVATEPROMPT_DATA_DIR"   # explicit override wins outright
   else
     set -- "$HOME/.claude/private-prompts" "$HOME/.cursor/private-prompts" "$HOME/.codex/private-prompts"
   fi
   privateprompt_file=""
   for privateprompt_dir in "$@"; do
     privateprompt_candidate="$privateprompt_dir/prompts/${privateprompt_hash}.md"
     [ -s "$privateprompt_candidate" ] || continue
     if [ -z "$privateprompt_file" ] || [ "$privateprompt_candidate" -nt "$privateprompt_file" ]; then
       privateprompt_file="$privateprompt_candidate"
     fi
   done
   test -n "$privateprompt_file" && printf '%s\n' "$privateprompt_file"
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
