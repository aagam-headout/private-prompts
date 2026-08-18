#!/usr/bin/env node
// Start the Private Prompt Vault server if it isn't already up, then open it.
//
// Node rather than shell on purpose: node is already required to run the server,
// so every host that can use this plugin can run this launcher — no bash, curl,
// nohup, or pkill needed, and no difference between Claude Code, Codex, Cursor,
// or a plain terminal on macOS, Linux, or Windows. (Opening the browser does
// shell out to the platform opener; failing that, the URL is printed instead.)
//
//   node start.js                # start (if needed) and open for the current directory
//   node start.js --cwd /path    # use another project directory
//   node start.js --no-open      # start only, print the URL
//   node start.js --port 9000    # non-default port
//   node start.js --stop         # stop the running server
//
// Honors PP_PORT, PP_RUNTIME, and PP_DATA_DIR.
"use strict";

const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const VAULT = __dirname;
const SERVER = path.join(VAULT, "private-prompt-server.js");
const RUNTIMES = new Set(["claude", "codex", "cursor"]);
// Where a server started by *this* launcher would keep data. Used to refuse a
// server on the port that would write somewhere else — see identityMismatch.
const EXPECTED_DATA_DIR = process.env.PP_DATA_DIR
  ? path.resolve(process.env.PP_DATA_DIR)
  : path.join(os.homedir(), ".private-prompt");

// Print the file's own header comment, however long it is — a fixed line range
// silently truncates the flag list the moment the header above changes.
function usage() {
  const out = [];
  for (const line of fs.readFileSync(__filename, "utf8").split("\n").slice(1)) {
    if (!line.startsWith("//")) break;
    out.push(line.replace(/^\/\/ ?/, ""));
  }
  console.log(out.join("\n").trim());
}

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), open: true, stop: false, port: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") { opts.cwd = path.resolve(argv[++i] || process.cwd()); }
    else if (arg === "--port") {
      const raw = argv[++i];
      opts.port = Number(raw);
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
        console.error(`private-prompt: --port needs an integer 1-65535, got "${raw}"`);
        process.exit(2);
      }
    }
    else if (arg === "--no-open") { opts.open = false; }
    else if (arg === "--stop") { opts.stop = true; }
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else { console.error(`private-prompt: unknown option ${arg}`); process.exit(2); }
  }
  return opts;
}

// Which CLI the page preselects for Enhance. Storage does not depend on this —
// there is one vault for every agent — so an install-path guess is enough, and
// PP_RUNTIME overrides it.
function detectRuntime() {
  const explicit = process.env.PP_RUNTIME;
  if (explicit && RUNTIMES.has(explicit)) return explicit;
  const where = VAULT.replace(/\\/g, "/");
  if (where.includes("/.cursor/")) return "cursor";
  if (where.includes("/.codex/")) return "codex";
  return "claude";
}

// Resolves { status, json } — the status matters as much as the body: a server
// that lacks a route answers 404 with valid JSON, which must not read as success.
function request(port, pathname, method = "GET") {
  return new Promise((resolve) => {
    const req = http.request(
      // Host header must match what the server allows, or it answers 403.
      { host: "127.0.0.1", port, path: pathname, method, timeout: 1500, headers: { host: `127.0.0.1:${port}` } },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(body); } catch { json = null; }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", () => resolve({ status: 0, json: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Any JSON-speaking process could hold this port, so require a 200 plus this
// server's own /health shape before believing a vault is up.
async function health(port) {
  const { status, json } = await request(port, "/health");
  if (status !== 200 || !json || json.ok !== true || typeof json.pid !== "number") return null;
  return json;
}

// A vault answering on the port is not automatically the *right* vault: an older
// install, or one started with a different PP_DATA_DIR, writes saves where the
// skills will not look for them — the user saves and the agent then reports "no
// saved prompt". Reuse only an install running this exact file and data dir.
function identityMismatch(info) {
  if (typeof info.server !== "string" || typeof info.dataDir !== "string") {
    return `an older vault server is on this port (pid ${info.pid}) and would save to a different location`;
  }
  if (path.resolve(info.server) !== SERVER) {
    return `a different vault install is on this port: ${info.server} (pid ${info.pid})`;
  }
  if (path.resolve(info.dataDir) !== EXPECTED_DATA_DIR) {
    return `the vault on this port stores data in ${info.dataDir}, not ${EXPECTED_DATA_DIR} (pid ${info.pid})`;
  }
  return null;
}

// ENOENT from a missing opener arrives as an async 'error' event, not a throw —
// unhandled it would crash the launcher *after* the server is already up, so the
// caller's "open this URL yourself" fallback has to hang off that event.
function openInBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
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

(async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envPort = Number(process.env.PP_PORT);
  const port = opts.port !== null ? opts.port
    : Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 8974;

  if (opts.stop) {
    // Ask the server to exit over the same loopback channel — no pkill or
    // taskkill, so this behaves the same on every platform.
    const running = await health(port);
    if (!running) { console.log("private-prompt: nothing to stop"); return; }
    const { status } = await request(port, "/shutdown", "POST");
    for (let i = 0; i < 20; i++) {
      if (!(await health(port))) { console.log("private-prompt: stopped"); return; }
      await sleep(100);
    }
    // Never claim success on a server that is still answering: an install
    // without /shutdown replies 404 and stays up, and silently "succeeding"
    // there is what leaves a stale server serving the wrong vault.
    console.error(
      `private-prompt: server on port ${port} is still running (pid ${running.pid}, /shutdown answered ${status || "nothing"}) — stop it manually: kill ${running.pid}`
    );
    process.exit(1);
  }

  if (!fs.existsSync(SERVER)) {
    console.error(`private-prompt: server missing at ${SERVER}`);
    process.exit(1);
  }

  const runtime = detectRuntime();
  let running = await health(port);

  if (running) {
    const mismatch = identityMismatch(running);
    if (mismatch) {
      console.error(`private-prompt: refusing to reuse port ${port} — ${mismatch}`);
      console.error(`private-prompt: stop it (\`node ${path.join(VAULT, "start.js")} --stop --port ${port}\`, or kill ${running.pid}) or pick another port with --port`);
      process.exit(1);
    }
    console.log(`private-prompt: already running on port ${port}`);
  } else {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PP_RUNTIME: runtime, PP_PORT: String(port) },
      stdio: "ignore",
      detached: true,
    });
    let spawnError = null;
    child.on("error", (err) => { spawnError = err; }); // async ENOENT, not a throw
    child.unref();
    // Poll instead of sleeping a fixed amount: usually ready in well under a second.
    for (let i = 0; i < 50; i++) {
      if (spawnError) break;
      running = await health(port);
      if (running) break;
      await sleep(100);
    }
    if (spawnError) {
      console.error(`private-prompt: could not launch node (${spawnError.message})`);
      process.exit(1);
    }
    if (!running) {
      // Either the server failed to boot, or something that is not this server
      // already holds the port — the health probe cannot tell those apart.
      console.error(`private-prompt: nothing answered /health on port ${port} — it may be held by another program (try --port)`);
      process.exit(1);
    }
    const mismatch = identityMismatch(running);
    if (mismatch) {
      // Lost the race to another launcher, or the port was taken by another vault
      // between the first probe and now.
      console.error(`private-prompt: port ${port} is served by another vault — ${mismatch}`);
      process.exit(1);
    }
    console.log(`private-prompt: started on port ${port} (runtime: ${runtime})`);
  }

  const url = `http://127.0.0.1:${port}/?cwd=${encodeURIComponent(opts.cwd)}`;
  console.log(url);
  if (opts.open && !(await openInBrowser(url))) {
    console.log("private-prompt: open the URL above in your browser");
  }
})();
