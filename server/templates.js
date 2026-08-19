// Named prompt skeletons, saved as plain text files under DATA_DIR/templates.
// Filesystem rather than the database: a template is authored and edited by
// hand as easily as queued, and needs no schema or migration.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Computed independently rather than imported from db.js: db.js pulls in
// node:sqlite at load time, which this module (loaded before the CLI's
// Node-version guard runs) must not trigger on an old Node.
const DATA_DIR = process.env.PV_DATA_DIR || path.join(os.homedir(), ".prompt-vault");
export const TEMPLATES_DIR = path.join(DATA_DIR, "templates");

// Templates are filenames on disk, so a name has to survive being one —
// no path separators or leading dots that could climb out of TEMPLATES_DIR.
function templatePath(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name || "")) {
    throw new Error(`invalid template name: "${name}" — use letters, numbers, - and _`);
  }
  return path.join(TEMPLATES_DIR, `${name}.txt`);
}

export function save(name, text) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Error("empty template — nothing to save");
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  fs.writeFileSync(templatePath(name), body, "utf8");
  return name;
}

export function read(name) {
  const file = templatePath(name); // throws its own message on an invalid name
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`no template named "${name}" — run \`agent-prompt-vault template list\``);
  }
}

export function list() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -4))
    .sort();
}

export function remove(name) {
  const p = templatePath(name);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}
