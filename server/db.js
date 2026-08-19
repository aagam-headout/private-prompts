// The only module that touches SQLite. Everything else — the HTTP server and
// the agent-facing CLI — goes through these functions, so the two writers can
// never disagree about the schema or about what "claiming" a prompt means.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DATA_DIR =
  process.env.PV_DATA_DIR || path.join(os.homedir(), ".prompt-vault");
export const DB_FILE = path.join(DATA_DIR, "vault.db");

export const STATUSES = ["pending", "in_progress", "done"];

let db = null;

export function open(file = DB_FILE) {
  if (db) return db;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // WAL so the browser server and an agent's CLI invocation can write
  // concurrently; busy_timeout so the loser of a race waits instead of throwing.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS prompts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project    TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending',
      position   REAL    NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      done_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS prompts_queue
      ON prompts (project, status, position);
  `);
  migrate(db);
  return db;
}

// Databases created before drag-to-reorder have no position column. Seeding it
// from id preserves the order those rows already had.
function migrate(d) {
  const columns = d.prepare("PRAGMA table_info(prompts)").all().map((c) => c.name);
  if (!columns.includes("position")) {
    d.exec("ALTER TABLE prompts ADD COLUMN position REAL NOT NULL DEFAULT 0");
    d.exec("UPDATE prompts SET position = id");
  }
}

export function close() {
  if (db) db.close();
  db = null;
}

// The project path is the queue's only partition key, and the UI and the CLI
// derive it independently — so both must normalize identically or an agent
// silently sees an empty queue. Resolve symlinks and drop trailing separators.
export function normalizeProject(cwd) {
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) return "";
  const trimmed = cwd.trim().replace(/[/\\]+$/, "") || cwd.trim();
  // realpathSync alone resolves symlinks but keeps whatever case the caller
  // typed, so on a case-insensitive filesystem (macOS, Windows) `/repo` and
  // `/Repo` would become two queues for one directory. The native variant
  // returns the on-disk spelling, which is the same for every caller.
  try {
    return fs.realpathSync.native(trimmed);
  } catch {}
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return trimmed; // path gone or unreadable — a stable name still beats none
  }
}

// A `.git` entry (a directory normally, a file inside a worktree) marks the top
// of a project.
export function repoRoot(project) {
  let dir = project;
  while (dir) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
  return null;
}

// The partition key for a working directory. An agent started in a
// subdirectory must see the same queue as one started at the repository root,
// so resolution walks up before the path is used as a key.
//
// Queues created before that walk-up existed are keyed by the exact directory
// they were opened from; preferring that key while it still holds rows keeps
// those prompts reachable instead of orphaning them under the root.
export function projectFor(cwd) {
  const exact = normalizeProject(cwd);
  if (!exact) return "";
  const root = repoRoot(exact);
  if (!root || root === exact) return exact;
  const { n } = open().prepare("SELECT COUNT(*) AS n FROM prompts WHERE project = ?").get(exact);
  return n > 0 ? exact : root;
}

export function projectName(project) {
  return path.basename(project) || project;
}

function decorate(row) {
  return { ...row, projectName: projectName(row.project) };
}

// Done prompts are never pruned, and the browser re-fetches the whole list
// every couple of seconds — so only the most recent ones travel. -1 lifts the
// cap for callers that want the real total (the CLI's `list`).
export const DONE_LIMIT = 50;

// Omit `project` to see every project's prompts — that's what the UI's "All
// projects" view uses. Agents always pass one.
export function list({ project, status, doneLimit = DONE_LIMIT } = {}) {
  const where = [];
  const args = [];
  if (project) {
    where.push("project = ?");
    args.push(project);
  }
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  const clause = (extra) => {
    const all = extra ? [...where, extra] : where;
    return all.length ? ` WHERE ${all.join(" AND ")}` : "";
  };
  const d = open();

  if (status) {
    // An explicit status filter is the caller's own slice; honour it verbatim,
    // capping only a request for the done pile.
    const capped = status === "done" && doneLimit >= 0;
    const sql =
      "SELECT * FROM prompts" +
      clause() +
      (capped ? " ORDER BY done_at DESC, id DESC LIMIT ?" : " ORDER BY position, id");
    return d.prepare(sql).all(...args, ...(capped ? [doneLimit] : [])).map(decorate);
  }

  // Two queries rather than one: the live queue is ordered by position, while
  // the done pile is ordered by when it was finished and is capped.
  const live = d
    .prepare("SELECT * FROM prompts" + clause("status != 'done'") + " ORDER BY position, id")
    .all(...args);
  const doneSql =
    "SELECT * FROM prompts" +
    clause("status = 'done'") +
    " ORDER BY done_at DESC, id DESC" +
    (doneLimit >= 0 ? " LIMIT ?" : "");
  const done = d.prepare(doneSql).all(...args, ...(doneLimit >= 0 ? [doneLimit] : []));
  return [...live, ...done].map(decorate);
}

export function get(id) {
  const row = open().prepare("SELECT * FROM prompts WHERE id = ?").get(id);
  return row ? decorate(row) : null;
}

export function add({ project, text }) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Error("empty prompt — nothing to queue");
  const proj = normalizeProject(project);
  if (!proj) throw new Error("missing project path");
  const d = open();
  // New prompts land at the end of that project's queue.
  const { next } = d
    .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM prompts WHERE project = ?")
    .get(proj);
  const { lastInsertRowid } = d
    .prepare(
      "INSERT INTO prompts (project, text, status, position, created_at) VALUES (?, ?, 'pending', ?, ?)"
    )
    .run(proj, body, next, Date.now());
  return get(Number(lastInsertRowid));
}

// Same insert as `add`, repeated for each line of a bulk import, but in one
// transaction — so a failure partway through leaves nothing half-queued, and
// two concurrent bulk imports can't interleave their MAX(position) reads into
// duplicate positions the way N independent add() calls could.
export function addMany(project, texts) {
  const proj = normalizeProject(project);
  if (!proj) throw new Error("missing project path");
  const bodies = texts.map((text) => (typeof text === "string" ? text.trim() : ""));
  if (bodies.some((body) => !body)) throw new Error("empty prompt — nothing to queue");
  const d = open();
  d.exec("BEGIN IMMEDIATE");
  try {
    const { next } = d
      .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM prompts WHERE project = ?")
      .get(proj);
    const insert = d.prepare(
      "INSERT INTO prompts (project, text, status, position, created_at) VALUES (?, ?, 'pending', ?, ?)"
    );
    const ids = bodies.map((body, i) => Number(insert.run(proj, body, next + i, Date.now()).lastInsertRowid));
    d.exec("COMMIT");
    return ids.map((id) => get(id));
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function edit(id, text) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Error("empty prompt — nothing to save");
  open().prepare("UPDATE prompts SET text = ? WHERE id = ?").run(body, id);
  return get(id);
}

// Reassign a prompt to another project, dropping it at the end of that
// project's queue so it never lands in the middle of unrelated work.
export function move(id, project) {
  const proj = normalizeProject(project);
  if (!proj) throw new Error("missing project path");
  const d = open();
  const { next } = d
    .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM prompts WHERE project = ?")
    .get(proj);
  d.prepare("UPDATE prompts SET project = ?, position = ? WHERE id = ?").run(proj, next, id);
  return get(id);
}

export function remove(id) {
  return open().prepare("DELETE FROM prompts WHERE id = ?").run(id).changes > 0;
}

export function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  const d = open();
  const row = d.prepare("SELECT project, status FROM prompts WHERE id = ?").get(id);
  if (!row) return null;
  d.prepare("UPDATE prompts SET status = ?, done_at = ? WHERE id = ?").run(
    status,
    status === "done" ? Date.now() : null,
    id
  );
  // Returning to the queue means returning to the *back* of it. Keeping the old
  // position would let a prompt finished last week cut ahead of everything
  // queued since.
  if (status === "pending" && row.status !== "pending") {
    const { next } = d
      .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM prompts WHERE project = ?")
      .get(row.project);
    d.prepare("UPDATE prompts SET position = ? WHERE id = ?").run(next, id);
  }
  return get(id);
}

// Take the oldest pending prompts for a project and flip them to in_progress in
// one transaction. Doing the select and the update atomically is what stops two
// agents — or one agent run twice — from picking up the same prompt.
// `count` of -1 means "all of them" (SQLite reads LIMIT -1 as unbounded).
export function claim(project, count = 1) {
  const proj = normalizeProject(project);
  if (!proj) throw new Error("missing project path");
  const d = open();
  d.exec("BEGIN IMMEDIATE");
  try {
    const rows = d
      .prepare(
        "SELECT * FROM prompts WHERE project = ? AND status = 'pending' ORDER BY position, id LIMIT ?"
      )
      .all(proj, count);
    const update = d.prepare("UPDATE prompts SET status = 'in_progress' WHERE id = ?");
    for (const row of rows) update.run(row.id);
    d.exec("COMMIT");
    return rows.map((row) => decorate({ ...row, status: "in_progress" }));
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// The client sends a project's pending prompts in their new order; the server
// renumbers them 1..n in one transaction. Simpler than midpoint arithmetic and
// it cannot drift out of range no matter how many times a row is dragged.
export function reorder(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const d = open();
  d.exec("BEGIN IMMEDIATE");
  try {
    const update = d.prepare("UPDATE prompts SET position = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index + 1, Number(id)));
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// Crash recovery: an agent killed between `next` and `done` leaves its prompts
// claimed, and nothing in the CLI could hand them back. Returns the requeued
// rows so the caller can report exactly what moved.
export function requeueStalled(project) {
  const proj = normalizeProject(project);
  if (!proj) throw new Error("missing project path");
  const rows = open()
    .prepare("SELECT id FROM prompts WHERE project = ? AND status = 'in_progress' ORDER BY position, id")
    .all(proj);
  return rows.map((row) => setStatus(row.id, "pending"));
}

export function complete(id) {
  const row = get(id);
  if (!row) return null;
  return setStatus(id, "done");
}

// Distinct projects that have ever had a prompt, so the UI's filter can list
// them without the client scanning every row.
export function projects() {
  return open()
    .prepare(
      `SELECT project,
              SUM(status = 'pending')     AS pending,
              SUM(status = 'in_progress') AS inProgress,
              SUM(status = 'done')        AS done
         FROM prompts GROUP BY project ORDER BY project`
    )
    .all()
    .map((row) => ({ ...row, name: projectName(row.project) }));
}
