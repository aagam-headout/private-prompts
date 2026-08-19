#!/usr/bin/env node
// prompt-vault — a local prompt queue for coding agents.
//
//   npx agent-prompt-vault                 start the vault (if needed) and open it
//   npx agent-prompt-vault --no-open       start only, print the URL
//   npx agent-prompt-vault --stop          stop the running vault
//
//   npx agent-prompt-vault add "text"                 queue a new prompt
//   npx agent-prompt-vault add < file.txt             queue a prompt read from stdin
//   npx agent-prompt-vault add --each-line < tasks.txt  queue one prompt per line
//   npx agent-prompt-vault next            claim the next pending prompt
//   npx agent-prompt-vault next 2          claim the next 2
//   npx agent-prompt-vault next --all      claim every pending prompt
//   npx agent-prompt-vault done 7          mark prompt 7 done
//   npx agent-prompt-vault done 7 8 9      mark several done
//   npx agent-prompt-vault reset           hand every claimed prompt back to the queue
//   npx agent-prompt-vault reset 7         hand prompt 7 back
//   npx agent-prompt-vault list            show this project's queue
//   npx agent-prompt-vault list --pending-only     show only pending prompts
//   npx agent-prompt-vault peek             show the next pending prompt, without claiming it
//   npx agent-prompt-vault peek 3           show the next 3 pending prompts
//   npx agent-prompt-vault add --template refactor   queue a saved prompt skeleton
//   npx agent-prompt-vault template save refactor "text"  save a reusable skeleton
//   npx agent-prompt-vault template list             list saved skeletons
//   npx agent-prompt-vault template show refactor    print a saved skeleton
//   npx agent-prompt-vault template remove refactor  delete a saved skeleton
//
// `next`, `done`, `list`, and `peek` talk to the database directly, so they
// work whether or not the browser vault is running.
//
// A working directory inside a git repository resolves to the repository root,
// so an agent started in a subdirectory shares one queue with the root.
//
// Flags: --cwd <path> (default: current directory), --port <n>, --json,
//        --force (let done/reset touch another project's prompt),
//        --status <pending|in_progress|done> and --pending-only (list),
//        --template <name> (add).
// Environment: PV_DATA_DIR (default ~/.prompt-vault), PV_PORT (default 8974).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { silenceSqliteWarning } from "./quiet.js";
import * as templates from "./templates.js";

silenceSqliteWarning();

// node:sqlite arrived in 22.5; importing it on anything older throws
// ERR_UNKNOWN_BUILTIN_MODULE, which reads like a bug in this tool rather than a
// version problem. Checking here means callers never have to pre-flight Node.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `prompt-vault: needs Node.js 22.5 or newer (running ${process.versions.node}) — ` +
    `its queue uses Node's built-in SQLite`
  );
  process.exit(1);
}

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
  const opts = {
    command: "open", cwd: process.cwd(), open: true, port: null,
    count: 1, ids: [], json: false, force: false, status: null, template: null,
  };
  const positional = [];
  // A flag that swallowed the next token would silently point --cwd at
  // "--json"; requiring a non-flag value turns that typo into an error.
  const value = (i, flag) => {
    const raw = argv[i];
    if (raw === undefined || raw.startsWith("-")) die(`${flag} needs a value`);
    return raw;
  };
  // --pending-only and --status both set opts.status; tracked separately here
  // so whichever came later in argv can't silently win over the other without
  // at least agreeing on "pending" — argv order deciding the outcome is worse
  // than refusing to guess.
  let pendingOnly = false;
  let statusFlag = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") opts.cwd = path.resolve(value(++i, "--cwd"));
    else if (arg === "--port") {
      const raw = value(++i, "--port");
      opts.port = Number(raw);
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
        die(`--port needs an integer 1-65535, got "${raw}"`);
      }
    } else if (arg === "--no-open") opts.open = false;
    else if (arg === "--stop") opts.command = "stop";
    else if (arg === "--all") opts.count = -1; // SQLite reads LIMIT -1 as unbounded
    else if (arg === "--json") opts.json = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--each-line") opts.eachLine = true;
    else if (arg === "--pending-only") pendingOnly = true;
    else if (arg === "--status") {
      const raw = value(++i, "--status");
      if (!db.STATUSES.includes(raw)) die(`--status needs one of ${db.STATUSES.join(", ")}, got "${raw}"`);
      statusFlag = raw;
    } else if (arg === "--template") opts.template = value(++i, "--template");
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) die(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (pendingOnly && statusFlag && statusFlag !== "pending") {
    die(`--pending-only conflicts with --status ${statusFlag}`);
  }
  opts.status = statusFlag ?? (pendingOnly ? "pending" : null);

  if (positional.length) {
    const [command, ...rest] = positional;
    if (!["open", "add", "next", "done", "list", "reset", "stop", "peek", "template"].includes(command)) {
      die(`unknown command "${command}" — try --help`);
    }
    opts.command = command;
    const ids = (label) => rest.map((raw) => {
      const n = Number(raw);
      // Extra arguments used to be dropped silently, which looked like a
      // prompt had been handled when it had not.
      if (!Number.isInteger(n) || n < 1) die(`${label} needs prompt ids, got "${raw}"`);
      return n;
    });
    if (command === "add") {
      // Joined rather than quoted-required: `add fix the login bug` reads
      // naturally, same as `git commit -m` without quotes would not. Left
      // undefined (not "") when no args were given, so `add ""` still reaches
      // db's "empty prompt" error instead of silently falling to stdin.
      if (rest.length) opts.text = rest.join(" ");
    } else if (command === "next") {
      if (rest.length > 1) die(`next takes one count, got "${rest.join(" ")}"`);
      if (rest.length === 1) {
        const n = Number(rest[0]);
        if (!Number.isInteger(n) || n < 1) die(`next needs a positive count, got "${rest[0]}"`);
        opts.count = n;
      }
    } else if (command === "done") {
      opts.ids = ids("done");
      if (!opts.ids.length) die("done needs a prompt id, e.g. `done 7`");
    } else if (command === "reset") {
      opts.ids = ids("reset"); // empty means every claimed prompt in this project
    } else if (command === "peek") {
      if (rest.length > 1) die(`peek takes one count, got "${rest.join(" ")}"`);
      if (rest.length === 1) {
        const n = Number(rest[0]);
        if (!Number.isInteger(n) || n < 1) die(`peek needs a positive count, got "${rest[0]}"`);
        opts.count = n;
      }
    } else if (command === "template") {
      const [action, name, ...textParts] = rest;
      if (!["save", "list", "show", "remove"].includes(action)) {
        die(`template needs an action: save, list, show, or remove — got "${action ?? ""}"`);
      }
      opts.templateAction = action;
      if (action === "list") {
        if (rest.length > 1) die(`template list takes no arguments, got "${rest.slice(1).join(" ")}"`);
      } else {
        if (!name) die(`template ${action} needs a name, e.g. \`template ${action} refactor\``);
        opts.templateName = name;
        // save is the only action that takes trailing text; show/remove
        // dropping extra words silently would look like they'd been handled.
        if (action !== "save" && textParts.length) {
          die(`template ${action} takes no arguments beyond the name, got "${textParts.join(" ")}"`);
        }
        // Left undefined (not "") when no text was given, so `save` falls back
        // to stdin the same way `add` does.
        if (action === "save" && textParts.length) opts.templateText = textParts.join(" ");
      }
    } else if (rest.length) {
      die(`${command} takes no arguments, got "${rest.join(" ")}"`);
    }
  }
  // --status/--pending-only only mean something to `list`; letting them
  // silently no-op on other commands (e.g. `peek --status done` still only
  // ever looks at pending) hides that the flag was ignored.
  if (opts.status !== null && opts.command !== "list") {
    die(`--status/--pending-only only apply to \`list\`, not \`${opts.command}\``);
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
      die(`stop it (\`npx agent-prompt-vault --stop --port ${port}\`, or kill ${running.pid}) or pick another port with --port`);
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

  // Resolve here too, so the page queues prompts under the same key the
  // agent's `next` will read from.
  const url = `http://127.0.0.1:${port}/?project=${encodeURIComponent(db.projectFor(opts.cwd))}`;
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

// Args win when given; otherwise fall back to stdin so a multi-line prompt
// can be piped in (`cat prompt.txt | prompt-vault add`) instead of forcing it
// onto one shell-quoted line. Refusing when stdin is a TTY stops `add` with no
// arguments from hanging, waiting on input that will never arrive.
function commandAdd(opts) {
  if (opts.eachLine && opts.text !== undefined) die("--each-line reads prompts from stdin, not from arguments");
  if (opts.eachLine && opts.template !== null) die("--each-line and --template do not combine — a template is one prompt");
  const project = db.projectFor(opts.cwd);

  if (opts.template !== null) {
    // Reading the template happens before touching stdin: a bad name should
    // fail loud, not after the terminal is left waiting on input that was
    // never coming.
    const skeleton = templates.read(opts.template).trim();
    // Extra text (arguments or piped stdin) appends as its own paragraph,
    // rather than replacing the skeleton — the point is to extend a known
    // shape, not to route around it.
    let extra = opts.text;
    if (extra === undefined && !process.stdin.isTTY) extra = fs.readFileSync(0, "utf8").trim();
    const text = extra ? `${skeleton}\n\n${extra}` : skeleton;
    const prompt = db.add({ project, text });
    if (opts.json) {
      console.log(JSON.stringify(prompt, null, 2));
      return;
    }
    console.log(`prompt-vault: queued prompt ${prompt.id} (from template "${opts.template}")`);
    return;
  }

  if (opts.eachLine) {
    if (process.stdin.isTTY) die("--each-line needs piped input, e.g. `add --each-line < tasks.txt`");
    const lines = fs.readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) die("no non-empty lines to queue");
    // One transaction for the whole batch: db.js's other multi-row writers
    // (claim, reorder) commit atomically too, so a failure partway through
    // doesn't leave some lines queued and others not.
    const queued = db.addMany(project, lines);
    if (opts.json) {
      console.log(JSON.stringify(queued, null, 2));
      return;
    }
    console.log(`prompt-vault: queued ${queued.length} prompts: ${queued.map((p) => p.id).join(" ")}`);
    return;
  }

  // undefined (no args given) falls back to stdin; "" (an explicit empty
  // argument) is left alone so db.add's "empty prompt" error still fires.
  let text = opts.text;
  if (text === undefined) {
    if (process.stdin.isTTY) die(`add needs prompt text, e.g. \`add fix the login bug\`, or pipe text on stdin`);
    text = fs.readFileSync(0, "utf8");
  }
  const prompt = db.add({ project, text });
  if (opts.json) {
    console.log(JSON.stringify(prompt, null, 2));
    return;
  }
  console.log(`prompt-vault: queued prompt ${prompt.id}`);
}

function commandNext(opts) {
  const project = db.projectFor(opts.cwd);
  const claimed = db.claim(project, opts.count);
  if (!claimed.length) {
    if (opts.json) console.log("[]");
    else console.log(`prompt-vault: no pending prompts for ${project}`);
    return;
  }
  printPrompts(claimed, opts);
  if (!opts.json) {
    const ids = claimed.map((p) => p.id).join(" ");
    console.log(`Mark each done as you finish it: npx agent-prompt-vault done <id>   (claimed: ${ids})`);
    console.log(`If you cannot finish them: npx agent-prompt-vault reset ${ids}`);
  }
}

// An id is global while a queue is per project, so an agent working in one
// repository could otherwise close out another repository's prompt by typing
// the wrong number.
function assertOwned(prompt, project, opts, verb) {
  if (opts.force || prompt.project === project) return;
  die(
    `prompt ${prompt.id} belongs to ${prompt.project}, not ${project} — ` +
    `run ${verb} from there, or pass --force`
  );
}

function commandDone(opts) {
  const project = db.projectFor(opts.cwd);
  const finished = [];
  for (const id of opts.ids) {
    const existing = db.get(id);
    if (!existing) die(`no prompt with id ${id}`);
    assertOwned(existing, project, opts, "done");
    finished.push(db.complete(id));
  }
  if (opts.json) {
    console.log(JSON.stringify(finished, null, 2));
    return;
  }
  for (const prompt of finished) console.log(`prompt-vault: prompt ${prompt.id} marked done`);
}

// Recovery after an agent dies mid-prompt: without this the prompt stays
// in_progress and `next` skips it forever.
function commandReset(opts) {
  const project = db.projectFor(opts.cwd);
  let requeued;
  if (opts.ids.length) {
    requeued = [];
    for (const id of opts.ids) {
      const existing = db.get(id);
      if (!existing) die(`no prompt with id ${id}`);
      assertOwned(existing, project, opts, "reset");
      requeued.push(db.setStatus(id, "pending"));
    }
  } else {
    requeued = db.requeueStalled(project);
  }
  if (opts.json) {
    console.log(JSON.stringify(requeued, null, 2));
    return;
  }
  if (!requeued.length) {
    console.log(`prompt-vault: no claimed prompts for ${project}`);
    return;
  }
  console.log(`prompt-vault: back in the queue: ${requeued.map((p) => p.id).join(" ")}`);
}

function commandList(opts) {
  const project = db.projectFor(opts.cwd);
  // -1: the CLI prints the whole history, not the browser's capped view.
  const prompts = db.list({ project, status: opts.status, doneLimit: -1 });
  if (opts.json) {
    console.log(JSON.stringify(prompts, null, 2));
    return;
  }
  if (!prompts.length) {
    console.log(
      opts.status
        ? `prompt-vault: no ${opts.status} prompts for ${project}`
        : `prompt-vault: queue is empty for ${project}`
    );
    return;
  }
  for (const prompt of prompts) {
    const firstLine = prompt.text.split("\n")[0];
    const summary = firstLine.length > 68 ? `${firstLine.slice(0, 67)}…` : firstLine;
    console.log(`${String(prompt.id).padStart(4)}  ${prompt.status.padEnd(11)}  ${summary}`);
  }
}

// Read-only look at what `next` would claim — same order, same count
// semantics, but never flips status, so an agent (or a person) can check the
// queue without taking a prompt off it.
function commandPeek(opts) {
  const project = db.projectFor(opts.cwd);
  const prompts = db.list({ project, status: "pending", doneLimit: -1 }).slice(
    0,
    opts.count === -1 ? undefined : opts.count
  );
  if (!prompts.length) {
    if (opts.json) console.log("[]");
    else console.log(`prompt-vault: no pending prompts for ${project}`);
    return;
  }
  printPrompts(prompts, opts);
}

function commandTemplate(opts) {
  if (opts.templateAction === "list") {
    const names = templates.list();
    if (opts.json) {
      console.log(JSON.stringify(names, null, 2));
      return;
    }
    if (!names.length) {
      console.log("prompt-vault: no saved templates — `template save <name> \"text\"`");
      return;
    }
    for (const name of names) console.log(name);
    return;
  }

  if (opts.templateAction === "show") {
    console.log(templates.read(opts.templateName).trim());
    return;
  }

  if (opts.templateAction === "remove") {
    const removed = templates.remove(opts.templateName);
    if (opts.json) {
      console.log(JSON.stringify({ name: opts.templateName, removed }));
      return;
    }
    console.log(
      removed
        ? `prompt-vault: removed template "${opts.templateName}"`
        : `prompt-vault: no template named "${opts.templateName}"`
    );
    return;
  }

  // save
  let text = opts.templateText;
  if (text === undefined) {
    if (process.stdin.isTTY) {
      die(`template save needs text, e.g. \`template save ${opts.templateName} "text"\`, or pipe text on stdin`);
    }
    text = fs.readFileSync(0, "utf8");
  }
  templates.save(opts.templateName, text);
  console.log(`prompt-vault: saved template "${opts.templateName}"`);
}

// ---------- main ----------

const opts = parseArgs(process.argv.slice(2));
const envPort = Number(process.env.PV_PORT);
const port = opts.port !== null ? opts.port
  : Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 8974;

try {
  if (opts.command === "open") await commandOpen(opts, port);
  else if (opts.command === "stop") await commandStop(port);
  else if (opts.command === "add") commandAdd(opts);
  else if (opts.command === "next") commandNext(opts);
  else if (opts.command === "done") commandDone(opts);
  else if (opts.command === "reset") commandReset(opts);
  else if (opts.command === "list") commandList(opts);
  else if (opts.command === "peek") commandPeek(opts);
  else if (opts.command === "template") commandTemplate(opts);
} catch (err) {
  die(err.message);
}
