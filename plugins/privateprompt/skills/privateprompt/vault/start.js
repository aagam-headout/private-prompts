#!/usr/bin/env node
// Start the Private Prompt Vault server if it isn't already up, then open it.
//
// Node rather than shell on purpose: node is already required to run the server,
// so every host that can use this plugin can run this launcher — no bash, curl,
// nohup, pkill, or `open` needed, and no difference between Claude Code, Codex,
// Cursor, or a plain terminal on macOS, Linux, or Windows.
//
//   node start.js                # start (if needed) and open for the current directory
//   node start.js --cwd /path    # use another project directory
//   node start.js --no-open      # start only, print the URL
//   node start.js --port 9000    # non-default port
//   node start.js --stop         # stop the running server
//
// Honors PRIVATEPROMPT_PORT, PRIVATEPROMPT_RUNTIME, and PRIVATEPROMPT_DATA_DIR.
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const VAULT = __dirname;
const SERVER = path.join(VAULT, "privateprompt-server.js");
const RUNTIMES = new Set(["claude", "codex", "cursor"]);

function usage() {
  const src = fs.readFileSync(__filename, "utf8").split("\n").slice(1, 15);
  console.log(src.map((l) => l.replace(/^\/\/ ?/, "")).join("\n").trim());
}

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), open: true, stop: false, port: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") { opts.cwd = argv[++i] || process.cwd(); }
    else if (arg === "--port") { opts.port = Number(argv[++i]); }
    else if (arg === "--no-open") { opts.open = false; }
    else if (arg === "--stop") { opts.stop = true; }
    else if (arg === "-h" || arg === "--help") { usage(); process.exit(0); }
    else { console.error(`privateprompt: unknown option ${arg}`); process.exit(2); }
  }
  return opts;
}

// Which agent runtime owns the data directory. Hosts do not export their
// plugin-root variables into child processes, so an explicit
// PRIVATEPROMPT_RUNTIME is the only signal that can be trusted here; otherwise
// infer it from where this copy of the plugin is installed.
function detectRuntime() {
  const explicit = process.env.PRIVATEPROMPT_RUNTIME;
  if (explicit && RUNTIMES.has(explicit)) return explicit;
  const where = VAULT.replace(/\\/g, "/");
  if (where.includes("/.claude/")) return "claude";
  if (where.includes("/.cursor/")) return "cursor";
  if (where.includes("/.codex/")) return "codex";
  return "codex";
}

function getJson(port, pathname, method = "GET") {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method, timeout: 1500 },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openInBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

(async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envPort = Number(process.env.PRIVATEPROMPT_PORT);
  const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port
    : Number.isInteger(envPort) && envPort > 0 ? envPort : 8974;

  if (opts.stop) {
    // Ask the server to exit over the same loopback channel — no pkill or
    // taskkill, so this behaves the same on every platform.
    const health = await getJson(port, "/health");
    if (!health) { console.log("privateprompt: nothing to stop"); return; }
    await getJson(port, "/shutdown", "POST");
    for (let i = 0; i < 20; i++) {
      if (!(await getJson(port, "/health"))) break;
      await sleep(100);
    }
    console.log("privateprompt: stopped");
    return;
  }

  if (!fs.existsSync(SERVER)) {
    console.error(`privateprompt: server missing at ${SERVER}`);
    process.exit(1);
  }

  const runtime = detectRuntime();
  let health = await getJson(port, "/health");

  if (health) {
    // A different runtime means a different data directory, so reusing it would
    // read and write the wrong vault.
    if (health.runtime && health.runtime !== runtime) {
      console.error(`privateprompt: port ${port} is serving runtime "${health.runtime}", not "${runtime}" — stop it first (node start.js --stop)`);
      process.exit(1);
    }
    console.log(`privateprompt: already running on port ${port}`);
  } else {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PRIVATEPROMPT_RUNTIME: runtime, PRIVATEPROMPT_PORT: String(port) },
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    // Poll instead of sleeping a fixed amount: usually ready in well under a second.
    for (let i = 0; i < 50; i++) {
      health = await getJson(port, "/health");
      if (health) break;
      await sleep(100);
    }
    if (!health) {
      console.error(`privateprompt: server did not come up on port ${port}`);
      process.exit(1);
    }
    console.log(`privateprompt: started on port ${port} (runtime: ${runtime})`);
  }

  const url = `http://127.0.0.1:${port}/?cwd=${encodeURIComponent(opts.cwd)}`;
  console.log(url);
  if (opts.open && !openInBrowser(url)) {
    console.log("privateprompt: open the URL above in your browser");
  }
})();
