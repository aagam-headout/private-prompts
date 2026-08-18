# Private Prompt Vault

Private Prompt Vault lets you draft a prompt in a local browser page, save it
outside the project, then have Codex read the saved file as reference context.
The prompt does not need to be typed or pasted into the task transcript or
saved in your repository.

- **Local storage.** The server binds to `127.0.0.1` and Codex drafts are saved
  under `~/.codex/private-prompts/`, not in the current repository.
- **Project-specific drafts.** Each project gets a separate file
  (`prompts/<sha1(cwd)>.md`), so using the vault in two projects does not
  overwrite either draft.
- **Optional enhancement.** Clicking **Enhance** runs an isolated, read-only
  `codex exec` process. It sends the draft to the configured Codex model; Save
  does not invoke Codex.
- **History.** Every Save snapshots the draft to a per-project, timestamped log
  (last 50 kept) — the page's **History** view lists them with a one-click
  restore back into Original.

## Install in Codex

```bash
codex plugin marketplace add aagam-headout/private-propmts
codex plugin add privateprompt@privateprompt
```

Start a new Codex task after installation. In a project, ask Codex to run:

```text
/privateprompt
```

Codex opens the local page, waits for you to save a draft, and then reads the
saved file only after you confirm it is ready.

After publishing a change, refresh and reinstall the plugin:

```bash
codex plugin marketplace upgrade privateprompt
codex plugin add privateprompt@privateprompt
```

## Claude Code and Cursor

Claude Code remains available through its marketplace:

```text
/plugin marketplace add aagam-headout/private-propmts
/plugin install privateprompt
```

For manual Codex, Cursor, or other agent-cli installations, copy
`plugins/privateprompt/` to the relevant plugin location and set
`PRIVATEPROMPT_PLUGIN_ROOT` to that copied directory. The Codex marketplace
installation above resolves the bundled vault automatically.

## Privacy notes

The browser page and saved draft stay local and outside the current project,
but the vault is not an end-to-end private model interaction. When Codex reads
the saved file as reference—or when you use **Enhance**—the prompt is supplied
to the selected CLI's configured model provider. The server also has no
authentication; it is loopback-only, but other processes under the same local
account can access it while it is running.

## Layout

```text
.agents/plugins/marketplace.json           — Codex marketplace catalog
.claude-plugin/marketplace.json            — Claude Code marketplace catalog
plugins/privateprompt/
  .codex-plugin/plugin.json                — Codex manifest
  .claude-plugin/plugin.json               — Claude Code manifest
  .cursor-plugin/plugin.json               — Cursor manifest
  skills/privateprompt/
    SKILL.md                                — agent workflow
    vault/
      privateprompt-server.js               — local Node.js server
      index.html                            — vault page
      style.css                             — vault styling
```

## Requirements

- Node.js (any recent version; the server uses only Node built-ins)
- `codex` on `PATH` for Codex Enhance (Save works without it)
- `claude` on `PATH` for Claude Code Enhance (Save works without it)

## License

MIT — see [LICENSE](LICENSE).
