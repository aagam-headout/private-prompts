#!/usr/bin/env node
// prompt-vault — a local prompt queue for coding agents.
//
//   npx prompt-vault                 start the vault (if needed) and open it
//   npx prompt-vault --no-open       start only, print the URL
//   npx prompt-vault --stop          stop the running vault
//
//   npx prompt-vault next            claim the next pending prompt
//   npx prompt-vault next 2          claim the next 2
//   npx prompt-vault next --all      claim every pending prompt
//   npx prompt-vault done 7          mark prompt 7 done
//   npx prompt-vault list            show this project's queue
//
// `next`, `done`, and `list` talk to the database directly, so they work
// whether or not the browser vault is running.
//
// Flags: --cwd <path> (default: current directory), --port <n>, --json.
// Environment: PV_DATA_DIR (default ~/.prompt-vault), PV_PORT (default 8974).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { silenceSqliteWarning } from "./quiet.js";

silenceSqliteWarning();

// Deferred so the warning filter above is installed before node:sqlite loads.
const db = await import("./db.js");

const SERVE = fileURLToPath(new URL("./serve.js", import.meta.url));
const SERVER_MODULE = fileURLToPath(new URL("./server.js", import.meta.url));

function usage() {
  const lines = [];
  for (const line of fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1)) {
    if (!line.startsWith("//")) break;
    lines.push(line.replace(/^\/\/ ?/, ""));
  }
  console.log(lines.join("\n").trim());
}

function die(message) {
  console.error(`prompt-vault: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { command: "open", cwd: process.cwd(), open: true, port: null, count: 1, id: null, json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") opts.cwd = path.resolve(argv[++i] || process.cwd());
    else if (arg === "--port") {
      const raw = argv[++i];
      opts.port = Number(raw);
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
        die(`--port needs an integer 1-65535, got "${raw}"`);
      }
    } else if (arg === "--no-open") opts.open = false;
    else if (arg === "--stop") opts.command = "stop";
    else if (arg === "--all") opts.count = -1; // SQLite reads LIMIT -1 as unbounded
    else if (arg === "--json") opts.json = true;
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) die(`unknown option ${arg}`);
    else positional.push(arg);
  }

  if (positional.length) {
    const [command, value] = positional;
    if (!["open", "next", "done", "list", "stop"].includes(command)) {
      die(`unknown command "${command}" — try --help`);
    }
    opts.command = command;
    if (command === "next" && value !== undefined) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) die(`next needs a positive count, got "${value}"`);
      opts.count = n;
    }
    if (command === "done") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) die(`done needs a prompt id, e.g. \`done 7\``);
      opts.id = n;
    }
  }
  return opts;
}

// ---------- launcher ----------

// Resolves { status, json }: the status matters as much as the body, since a
// server without a given route answers 404 with perfectly valid JSON.
function request(port, pathname, method = "GET") {
  return new Promise((resolve) => {
    const req = http.request(
      // Host must match what the server allows, or it answers 403.
      { host: "127.0.0.1", port, path: pathname, method, timeout: 1500, headers: { host: `127.0.0.1:${port}` } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = null; }
          resolve({ status: res.statusCode, json: parsed });
        });
      }
    );
    req.on("error", () => resolve({ status: 0, json: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Any JSON-speaking process could hold the port, so require a 200 plus this
// server's own /health shape before believing a vault is up.
async function health(port) {
  const { status, json } = await request(port, "/health");
  if (status !== 200 || !json || json.ok !== true || typeof json.pid !== "number") return null;
  return json;
}

// A vault answering on the port is not automatically the *right* vault: another
// install, or one started with a different PV_DATA_DIR, queues prompts where
// this CLI will not read them — the user adds a prompt and the agent then
// reports an empty queue.
function identityMismatch(info) {
  if (typeof info.server !== "string" || typeof info.dataDir !== "string") {
    return `an older vault is on this port (pid ${info.pid}) and would store prompts elsewhere`;
  }
  if (path.resolve(info.server) !== SERVER_MODULE) {
    return `a different vault install is on this port: ${info.server} (pid ${info.pid})`;
  }
  if (path.resolve(info.dataDir) !== path.resolve(db.DATA_DIR)) {
    return `the vault on this port stores data in ${info.dataDir}, not ${db.DATA_DIR} (pid ${info.pid})`;
  }
  return null;
}

// A missing opener surfaces as an async 'error' event rather than a throw —
// unhandled it would crash the CLI *after* the server is already up.
function openInBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: "ignore", detached: true });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.unref();
    // No error inside the grace window means the opener launched.
    const timer = setTimeout(() => resolve(true), 400);
    timer.unref();
  });
}

async function commandOpen(opts, port) {
  let running = await health(port);
  if (running) {
    const mismatch = identityMismatch(running);
    if (mismatch) {
      console.error(`prompt-vault: refusing to reuse port ${port} — ${mismatch}`);
      die(`stop it (\`npx prompt-vault --stop --port ${port}\`, or kill ${running.pid}) or pick another port with --port`);
    }
    console.log(`prompt-vault: already running on port ${port}`);
  } else {
    const child = spawn(process.execPath, [SERVE], {
      env: { ...process.env, PV_PORT: String(port) },
      stdio: "ignore",
      detached: true,
    });
    let spawnError = null;
    child.on("error", (err) => { spawnError = err; }); // async ENOENT, not a throw
    child.unref();
    // Poll rather than sleep a fixed amount: usually ready well under a second.
    for (let i = 0; i < 50; i++) {
      if (spawnError) break;
      running = await health(port);
      if (running) break;
      await sleep(100);
    }
    if (spawnError) die(`could not launch node (${spawnError.message})`);
    if (!running) {
      // Either the server failed to boot or something else holds the port —
      // a health probe cannot tell those apart.
      die(`nothing answered /health on port ${port} — it may be held by another program (try --port)`);
    }
    const mismatch = identityMismatch(running);
    if (mismatch) die(`port ${port} is served by another vault — ${mismatch}`);
    console.log(`prompt-vault: started on port ${port}`);
  }

  const url = `http://127.0.0.1:${port}/?project=${encodeURIComponent(opts.cwd)}`;
  console.log(url);
  if (opts.open && !(await openInBrowser(url))) {
    console.log("prompt-vault: open the URL above in your browser");
  }
}

async function commandStop(port) {
  const running = await health(port);
  if (!running) {
    console.log("prompt-vault: nothing to stop");
    return;
  }
  const { status } = await request(port, "/shutdown", "POST");
  for (let i = 0; i < 20; i++) {
    if (!(await health(port))) {
      console.log("prompt-vault: stopped");
      return;
    }
    await sleep(100);
  }
  // Never claim success while the server still answers — silently "succeeding"
  // there is what leaves a stale server serving the wrong vault.
  die(`server on port ${port} is still running (pid ${running.pid}, /shutdown answered ${status || "nothing"}) — stop it manually: kill ${running.pid}`);
}

// ---------- queue commands ----------

function printPrompts(prompts, opts) {
  if (opts.json) {
    console.log(JSON.stringify(prompts, null, 2));
    return;
  }
  for (const prompt of prompts) {
    console.log(`=== prompt ${prompt.id} ===`);
    console.log(prompt.text);
    console.log("");
  }
}

function commandNext(opts) {
  const project = db.normalizeProject(opts.cwd);
  const claimed = db.claim(project, opts.count);
  if (!claimed.length) {
    if (opts.json) console.log("[]");
    else console.log(`prompt-vault: no pending prompts for ${project}`);
    return;
  }
  printPrompts(claimed, opts);
  if (!opts.json) {
    const ids = claimed.map((p) => p.id).join(" ");
    console.log(`Mark each done as you finish it: npx prompt-vault done <id>   (claimed: ${ids})`);
  }
}

function commandDone(opts) {
  const prompt = db.complete(opts.id);
  if (!prompt) die(`no prompt with id ${opts.id}`);
  if (opts.json) console.log(JSON.stringify(prompt, null, 2));
  else console.log(`prompt-vault: prompt ${prompt.id} marked done`);
}

function commandList(opts) {
  const project = db.normalizeProject(opts.cwd);
  const prompts = db.list({ project });
  if (opts.json) {
    console.log(JSON.stringify(prompts, null, 2));
    return;
  }
  if (!prompts.length) {
    console.log(`prompt-vault: queue is empty for ${project}`);
    return;
  }
  for (const prompt of prompts) {
    const firstLine = prompt.text.split("\n")[0];
    const summary = firstLine.length > 68 ? `${firstLine.slice(0, 67)}…` : firstLine;
    console.log(`${String(prompt.id).padStart(4)}  ${prompt.status.padEnd(11)}  ${summary}`);
  }
}

// ---------- main ----------

const opts = parseArgs(process.argv.slice(2));
const envPort = Number(process.env.PV_PORT);
const port = opts.port !== null ? opts.port
  : Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 8974;

try {
  if (opts.command === "open") await commandOpen(opts, port);
  else if (opts.command === "stop") await commandStop(port);
  else if (opts.command === "next") commandNext(opts);
  else if (opts.command === "done") commandDone(opts);
  else if (opts.command === "list") commandList(opts);
} catch (err) {
  die(err.message);
}
