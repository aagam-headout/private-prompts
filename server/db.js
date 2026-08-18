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
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return trimmed; // path gone or unreadable — a stable name still beats none
  }
}

export function projectName(project) {
  return path.basename(project) || project;
}

function decorate(row) {
  return { ...row, projectName: projectName(row.project) };
}

// Omit `project` to see every project's prompts — that's what the UI's "All
// projects" view uses. Agents always pass one.
export function list({ project, status } = {}) {
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
  const sql =
    "SELECT * FROM prompts" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY position, id";
  return open().prepare(sql).all(...args).map(decorate);
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
  open()
    .prepare("UPDATE prompts SET status = ?, done_at = ? WHERE id = ?")
    .run(status, status === "done" ? Date.now() : null, id);
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
