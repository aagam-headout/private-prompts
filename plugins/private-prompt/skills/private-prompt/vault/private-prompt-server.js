#!/usr/bin/env node
// Private Prompt Vault — loopback-only server.
// Saving stays on disk. Enhance invokes the configured agent CLI, which may
// send the prompt to that CLI's configured model provider.
//
// Code lives inside the plugin install (this file). User data (saved prompts)
// lives in a stable, plugin-update-safe location outside the current project.
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

const ROOT = __dirname;

// One vault for every agent, at one fixed path. A per-runtime directory made
// the storage location depend on how the server happened to be launched, which
// is exactly what made "where is my saved prompt" ambiguous.
const DATA_DIR = process.env.PP_DATA_DIR || path.join(os.homedir(), ".private-prompt");
const PROMPTS_DIR = path.join(DATA_DIR, "prompts");
const NO_CWD_PROMPT_FILE = path.join(DATA_DIR, "prompt.md"); // used when no cwd given
const NO_CWD_HISTORY_FILE = path.join(DATA_DIR, "prompt.history.jsonl");

// RUNTIME only picks the Enhance defaults shown in the page (which CLI is
// preselected, which model table it gets). It has no say in where data lives.
const RUNTIME_RAW = process.env.PP_RUNTIME || "";
const RUNTIME = RUNTIME_RAW === "claude" || RUNTIME_RAW === "cursor" || RUNTIME_RAW === "codex"
  ? RUNTIME_RAW
  : "claude";
const SETTINGS_FILE = path.join(os.homedir(), ".claude", "settings.json");
const PORT_ENV = Number(process.env.PP_PORT);
const PORT = Number.isInteger(PORT_ENV) && PORT_ENV > 0 && PORT_ENV < 65536 ? PORT_ENV : 8974;
const MAX_BODY_BYTES = 512 * 1024; // 512KB — plenty for a prompt, guards against runaway payloads
const HISTORY_LIMIT = 50; // keep the vault file bounded — this is a scratch history, not an archive

try {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
} catch (err) {
  console.error(`[private-prompt] cannot create data dir ${PROMPTS_DIR}: ${err.message}`);
  process.exit(1);
}

// ---------- helpers ----------

function send(res, code, payload, contentType = "application/json") {
  const body = Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(code, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  try {
    send(res, 200, fs.readFileSync(filePath), contentType);
  } catch (err) {
    send(res, 500, { error: `failed to read ${path.basename(filePath)}: ${err.message}` });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({}); // malformed JSON -> treat as empty body rather than crash
      }
    });
    req.on("error", reject);
  });
}

// Enhance can target any installed agent CLI, not just the one that started
// this server — the picker in the page defaults to the current runtime but
// lets the user switch. Keep a model table and a binary name per CLI.
const CLI_BIN = { claude: "claude", codex: "codex", cursor: "agent" };
const ALL_MODEL_IDS = {
  claude: {
    haiku: "claude-haiku-4-5-20251001",
    sonnet: "claude-sonnet-5",
    opus: "claude-opus-5",
    default: "Claude CLI default",
  },
  codex: { default: "configured Codex model" },
  cursor: { default: "configured Cursor model" },
};
const DEFAULT_MODEL_FOR = { claude: "haiku", codex: "default", cursor: "default" };

const MODEL_IDS = ALL_MODEL_IDS[RUNTIME];
const DEFAULT_ENHANCE_MODEL = DEFAULT_MODEL_FOR[RUNTIME];
const CLI = CLI_BIN[RUNTIME];

function resolveModel(alias, cli = RUNTIME) {
  if (!alias || typeof alias !== "string") return "unknown";
  return ALL_MODEL_IDS[cli][alias] || alias;
}

function detectModel() {
  if (RUNTIME === "codex") return "configured Codex model";
  if (RUNTIME === "cursor") return "configured Cursor model";
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const settings = JSON.parse(raw);
    return (settings && typeof settings.model === "string" && settings.model) || "default";
  } catch {
    return "default"; // missing file, bad JSON, or no permission — all fall back quietly
  }
}

function gitBranch(cwd) {
  return new Promise((resolve) => {
    if (!cwd || typeof cwd !== "string") return resolve(null);
    let stat;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return resolve(null); // path doesn't exist
    }
    if (!stat.isDirectory()) return resolve(null);
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null); // not a git repo, git missing, detached weirdness — all fine, just no badge
      const branch = stdout.trim();
      resolve(branch && branch !== "HEAD" ? branch : null);
    });
  });
}

// One prompt file per repo/cwd so concurrent /private-prompt calls from
// different projects never clobber each other. No cwd -> shared scratch file.
function promptFileFor(cwd) {
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) return NO_CWD_PROMPT_FILE;
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  return path.join(PROMPTS_DIR, `${hash}.md`);
}

function historyFileFor(cwd) {
  if (!cwd || typeof cwd !== "string" || !cwd.trim()) return NO_CWD_HISTORY_FILE;
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  return path.join(PROMPTS_DIR, `${hash}.history.jsonl`);
}

function readHistoryLines(cwd) {
  const file = historyFileFor(cwd);
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return []; // corrupt/unreadable history — treat as empty rather than fail the caller
  }
}

function writeHistoryLines(cwd, lines) {
  const file = historyFileFor(cwd);
  const capped = lines.length > HISTORY_LIMIT ? lines.slice(lines.length - HISTORY_LIMIT) : lines;
  fs.writeFileSync(file, capped.length ? capped.join("\n") + "\n" : "", "utf8");
}

// Per-entry id the page uses to delete one snapshot. Derived from the entry, not
// stored, so reading a line always yields the same id — timestamps alone collide
// when two saves land in the same millisecond.
function historyId(entry) {
  return crypto.createHash("sha1").update(`${entry.ts} ${entry.content}`).digest("hex").slice(0, 12);
}

function parseHistoryLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed.content !== "string" || typeof parsed.ts !== "number") return null;
    return { ts: parsed.ts, content: parsed.content, id: historyId(parsed) };
  } catch {
    return null; // one bad line shouldn't sink the whole history
  }
}

// Every Save appends a snapshot here, oldest-first, capped at HISTORY_LIMIT —
// lets the page offer a "History" view without a database.
function appendHistory(cwd, content) {
  const lines = readHistoryLines(cwd);
  const newest = lines.length ? parseHistoryLine(lines[lines.length - 1]) : null;
  if (newest && newest.content === content) return; // re-saving the same text twice adds no information
  const entry = { ts: Date.now(), content };
  lines.push(JSON.stringify(entry)); // id is derived on read, never stored
  try {
    writeHistoryLines(cwd, lines);
  } catch (err) {
    console.error(`[private-prompt] failed to append history: ${err.message}`); // non-fatal — save itself already succeeded
  }
}

function deleteHistoryEntry(cwd, id) {
  const lines = readHistoryLines(cwd);
  const kept = lines.filter((line) => {
    const parsed = parseHistoryLine(line);
    return !parsed || parsed.id !== id;
  });
  if (kept.length === lines.length) return false;
  writeHistoryLines(cwd, kept);
  return true;
}

function readHistory(cwd) {
  const entries = [];
  for (const line of readHistoryLines(cwd)) {
    const parsed = parseHistoryLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries.reverse(); // newest first
}

function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [cmd], (err) => resolve(!err));
  });
}

function enhanceWithCodex(instruction, model, cwd, callback) {
  let tempDir;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "private-prompt-"));
  } catch (err) {
    callback(err);
    return;
  }
  const outputFile = path.join(tempDir, "response.txt");
  const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", outputFile];
  if (model && model !== "default") args.push("--model", model);
  if (cwd && typeof cwd === "string" && fs.existsSync(cwd)) args.push("--cd", cwd);

  let stderr = "";
  let finished = false;
  const finish = (err, output) => {
    if (finished) return;
    finished = true;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    callback(err, output);
  };
  const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"] });
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(Object.assign(new Error("timed out after 120s"), { timedOut: true }));
  }, 120000);
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.on("error", (err) => { clearTimeout(timer); finish(err); });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (finished) return;
    if (code !== 0) return finish(new Error((stderr || `exited with status ${code}`).trim()));
    try {
      finish(null, fs.readFileSync(outputFile, "utf8").trim());
    } catch (err) {
      finish(err);
    }
  });
  child.stdin.end(instruction);
}

function enhanceWithAgent(instruction, cwd, callback) {
  const args = ["-p", "--trust", "--output-format", "text"];
  if (cwd && typeof cwd === "string" && fs.existsSync(cwd)) args.push("--workspace", cwd);
  args.push(instruction);
  execFile("agent", args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      const detail = err.killed ? "timed out after 120s" : (stderr || err.message).trim().slice(0, 500);
      callback(new Error(detail));
      return;
    }
    callback(null, stdout.trim());
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return send(res, 400, { error: "bad request URL" });
  }

  try {
    if (req.method === "GET" && url.pathname === "/") {
      return sendFile(res, path.join(ROOT, "index.html"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/style.css") {
      return sendFile(res, path.join(ROOT, "style.css"), "text/css; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/models") {
      // All three CLIs' model tables, so switching the Enhance CLI picker can
      // repopulate the model dropdown without a round trip.
      return send(res, 200, { models: MODEL_IDS, default: DEFAULT_ENHANCE_MODEL, byCli: ALL_MODEL_IDS, defaultByCli: DEFAULT_MODEL_FOR });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, pid: process.pid, runtime: RUNTIME });
    }

    if (req.method === "POST" && url.pathname === "/shutdown") {
      // Lets the launcher stop the server on any platform without pkill or
      // taskkill. Same trust boundary as every other route: loopback only, and
      // any local process under this account can already reach /save.
      send(res, 200, { ok: true, stopping: true });
      setTimeout(() => process.exit(0), 50);
      return;
    }

    if (req.method === "GET" && url.pathname === "/load") {
      const file = promptFileFor(url.searchParams.get("cwd"));
      let content = "";
      try {
        if (fs.existsSync(file)) content = fs.readFileSync(file, "utf8");
      } catch (err) {
        return send(res, 500, { error: `failed to read prompt file: ${err.message}` });
      }
      return send(res, 200, { content });
    }

    if (req.method === "GET" && url.pathname === "/session") {
      const cwd = url.searchParams.get("cwd") || "";
      const branch = await gitBranch(cwd);
      const modelAlias = detectModel();
      const cliAvailable = await which(CLI);
      // Checked for all three so the Enhance CLI picker can grey out ones
      // that aren't installed, not just the runtime that started this server.
      const [claudeAvailable, codexAvailable, cursorAvailable] = await Promise.all(
        ["claude", "codex", "agent"].map(which)
      );
      return send(res, 200, {
        model: resolveModel(modelAlias),
        modelAlias,
        runtime: RUNTIME,
        cwd: cwd || null,
        repo: cwd ? path.basename(cwd.replace(/\/+$/, "")) || null : null,
        branch,
        cliAvailable,
        cliAvailability: { claude: claudeAvailable, codex: codexAvailable, cursor: cursorAvailable },
      });
    }

    if (req.method === "POST" && url.pathname === "/save") {
      let data;
      try {
        data = await readBody(req);
      } catch (err) {
        return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
      }
      const content = typeof data.content === "string" ? data.content : "";
      // Refuse blank saves outright: writing "" would wipe the project's saved
      // prompt with nothing recoverable in history.
      if (!content.trim()) return send(res, 400, { error: "empty prompt — nothing to save" });
      const file = promptFileFor(data.cwd);
      try {
        fs.writeFileSync(file, content, "utf8");
      } catch (err) {
        return send(res, 500, { error: `failed to save: ${err.message}` });
      }
      appendHistory(data.cwd, content);
      return send(res, 200, { ok: true, file, bytes: Buffer.byteLength(content) });
    }

    if (req.method === "GET" && url.pathname === "/history") {
      return send(res, 200, { entries: readHistory(url.searchParams.get("cwd")) });
    }

    if (req.method === "POST" && url.pathname === "/history/delete") {
      let data;
      try {
        data = await readBody(req);
      } catch (err) {
        return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
      }
      const id = typeof data.id === "string" ? data.id : "";
      if (!id) return send(res, 400, { error: "missing history entry id" });
      let removed;
      try {
        removed = deleteHistoryEntry(data.cwd, id);
      } catch (err) {
        return send(res, 500, { error: `failed to delete history entry: ${err.message}` });
      }
      // Already gone (deleted in another tab, or aged out) is not an error —
      // the caller's intent is satisfied either way.
      return send(res, 200, { ok: true, removed, entries: readHistory(data.cwd) });
    }

    if (req.method === "POST" && url.pathname === "/enhance") {
      let data;
      try {
        data = await readBody(req);
      } catch (err) {
        return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
      }
      const text = typeof data.content === "string" ? data.content : "";
      if (!text.trim()) return send(res, 400, { error: "empty prompt — nothing to enhance" });

      // The picker defaults to this server's runtime but the user can point
      // Enhance at any installed CLI, so resolve per-request, not from RUNTIME.
      const cli = CLI_BIN[data.cli] ? data.cli : RUNTIME;
      const cliBin = CLI_BIN[cli];
      const cliAvailable = await which(cliBin);
      if (!cliAvailable) {
        return send(res, 503, { error: `\`${cliBin}\` CLI not found in PATH — install it to use Enhance` });
      }

      const requestedModel = typeof data.model === "string" && data.model ? data.model : DEFAULT_MODEL_FOR[cli];
      const model = cli === "claude" && !ALL_MODEL_IDS.claude[requestedModel]
        ? DEFAULT_MODEL_FOR[cli]
        : requestedModel;

      const ctx = data.context && typeof data.context === "object" ? data.context : {};
      let contextLine = "";
      if (ctx.include) {
        const parts = [];
        if (typeof ctx.model === "string" && ctx.model) parts.push(`configured model: ${ctx.model}`);
        if (typeof ctx.repo === "string" && ctx.repo) parts.push(`project: ${ctx.repo}`);
        if (typeof ctx.branch === "string" && ctx.branch) parts.push(`git branch: ${ctx.branch}`);
        if (parts.length) {
          contextLine = `Session context (${parts.join(", ")}) — tailor phrasing/constraints for this project where relevant.\n\n`;
        }
      }
      const instruction =
        contextLine +
        "Improve and tighten this prompt. Keep intent identical. Return only the improved prompt, no commentary:\n\n" +
        text;
      if (cli === "codex") {
        enhanceWithCodex(instruction, model, ctx.include ? data.cwd : null, (err, output) => {
          if (err) return send(res, 502, { error: `codex CLI failed: ${err.message.slice(0, 500)}` });
          send(res, 200, { content: output || text });
        });
      } else if (cli === "cursor") {
        enhanceWithAgent(instruction, ctx.include ? data.cwd : null, (err, output) => {
          if (err) return send(res, 502, { error: `agent CLI failed: ${err.message.slice(0, 500)}` });
          send(res, 200, { content: output || text });
        });
      } else {
        const args = model === "default" ? ["-p", instruction] : ["-p", "--model", model, instruction];
        execFile("claude", args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const detail = err.killed ? "timed out after 120s" : (stderr || err.message).trim().slice(0, 500);
            return send(res, 502, { error: `claude CLI failed: ${detail}` });
          }
          const enhanced = stdout.trim();
          send(res, 200, { content: enhanced || text });
        });
      }
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    // Last-resort catch-all so a bug never hangs a request or crashes the server.
    console.error("[private-prompt] unhandled error:", err);
    if (!res.headersSent) send(res, 500, { error: "internal server error" });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Another instance is already serving — treat as success, not a crash.
    // The skill's start-check is a pgrep race; this makes it idempotent.
    console.error(`[private-prompt] port ${PORT} already in use — assuming another instance is running`);
    process.exit(0);
  }
  console.error("[private-prompt] server error:", err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[private-prompt] listening on http://127.0.0.1:${PORT}`);
});
