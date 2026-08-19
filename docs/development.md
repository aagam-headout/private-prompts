# Development

```bash
npm install
npm start          # API + built UI on :8974
npm run dev        # Vite dev server with hot reload, proxying /api to :8974
npm run build      # rebuild dist/
npm test           # node --test server/
```

The UI is built with Vite (React, Tailwind, shadcn/ui) and Geist is bundled
locally, so a running vault makes no external network requests.

`dist/` is **not** in git — the CLI resolves from the npm registry, so the built
UI only has to exist in the tarball, not in the repository. The
`prepack` script rebuilds it automatically on `npm pack` and `npm publish`,
which also makes it impossible to publish a stale bundle.

## Layout

- `server/cli.js` — the CLI entry point (`add`, `next`, `done`, `list`, `peek`,
  `reset`, `template`, `open`, `stop`).
- `server/db.js` — the only module that touches SQLite.
- `server/templates.js` — filesystem-backed prompt skeletons.
- `server/server.js` / `server/serve.js` — the local HTTP API and static server.
- `ui/` — the browser page (React).
- `plugins/prompt-vault/` — the Claude Code / Codex / Cursor plugin (skills
  that shell out to the published CLI).

## Requirements

Node.js 22.5 or newer. The vault uses Node's built-in `node:sqlite`, so it has
no runtime dependencies at all — nothing to compile, nothing to install.
