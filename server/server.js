// Loopback-only HTTP server: serves the built React UI from dist/ and a small
// JSON API over the prompt queue. All storage goes through db.js.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as db from "./db.js";
import * as enhancer from "./enhance.js";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const MAX_BODY_BYTES = 512 * 1024; // plenty for a prompt; guards runaway payloads

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Buffers, not string concatenation: a multi-byte character (emoji, CJK, a
    // curly quote) split across two chunks decodes to U+FFFD if each chunk is
    // stringified on its own. Decode once, over the whole body.
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({}); // malformed JSON -> empty body rather than a crash
      }
    });
    req.on("error", reject);
  });
}

// Binding to 127.0.0.1 keeps other machines out, but it does not keep *web
// pages* out: a site the user is browsing can POST to this port, and DNS
// rebinding (a hostname resolving to 127.0.0.1) would let it read the queue.
// Both carry a foreign Host or Origin, so check them. Same-account local
// processes stay trusted — they can already read the DB file directly.
function guard(req, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = String(req.headers.host || "").toLowerCase();
  if (!allowed.has(host)) return `unexpected Host header (${host || "absent"})`;
  // Sent by every current browser; absent for curl and other non-browser clients.
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return `cross-site request (${site})`;
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = "";
    }
    if (!allowed.has(originHost)) return `unexpected Origin (${origin})`;
  }
  return null;
}

function serveStatic(res, pathname) {
  // Resolve inside DIST and verify — a crafted "/../.." must not escape.
  const target = path.resolve(DIST, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!target.startsWith(DIST)) return send(res, 403, { error: "forbidden" });
  let body;
  try {
    body = fs.readFileSync(target);
  } catch {
    // Unknown path: fall back to index.html so the UI owns its own routing.
    try {
      body = fs.readFileSync(path.join(DIST, "index.html"));
    } catch {
      return send(res, 500, {
        error: "UI build missing — run `npm run build` (or reinstall the package)",
      });
    }
    res.writeHead(200, { "Content-Type": MIME[".html"], "Content-Length": body.length });
    return res.end(body);
  }
  const type = MIME[path.extname(target)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length });
  res.end(body);
}

export function createServer(port) {
  return http.createServer(async (req, res) => {
    const refused = guard(req, port);
    if (refused) {
      console.error(`[prompt-vault] refused ${req.method} ${req.url}: ${refused}`);
      return send(res, 403, { error: `refused: ${refused}` });
    }

    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, { error: "bad request URL" });
    }
    const { pathname } = url;

    try {
      if (req.method === "GET" && pathname === "/health") {
        // `server` and `dataDir` let the launcher tell "our vault" from some
        // other install on this port — reusing the wrong one files prompts
        // where the agent will not look for them.
        return send(res, 200, {
          ok: true,
          pid: process.pid,
          server: SELF,
          dataDir: db.DATA_DIR,
        });
      }

      if (req.method === "POST" && pathname === "/shutdown") {
        send(res, 200, { ok: true, stopping: true });
        setTimeout(() => process.exit(0), 50);
        return;
      }

      if (req.method === "GET" && pathname === "/api/session") {
        // Everything the Enhance panel needs to render itself: which CLIs are
        // installed, each one's model table, and the project context it can
        // optionally fold into the instruction.
        const project = db.normalizeProject(url.searchParams.get("project"));
        const [cliAvailability, branch] = await Promise.all([
          enhancer.availability(),
          enhancer.gitBranch(project),
        ]);
        return send(res, 200, {
          cliAvailability,
          models: enhancer.MODELS,
          defaultModel: enhancer.DEFAULT_MODEL,
          project: project || null,
          repo: project ? db.projectName(project) : null,
          branch,
        });
      }

      if (req.method === "POST" && pathname === "/api/enhance") {
        let data;
        try {
          data = await readBody(req);
        } catch (err) {
          return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
        }
        try {
          const content = await enhancer.enhance({
            text: data.text,
            cli: data.cli,
            model: data.model,
            cwd: db.normalizeProject(data.project),
            context: data.context,
          });
          return send(res, 200, { content });
        } catch (err) {
          return send(res, err.status || 502, { error: err.message });
        }
      }

      if (req.method === "GET" && pathname === "/api/projects") {
        return send(res, 200, { projects: db.projects() });
      }

      if (req.method === "GET" && pathname === "/api/prompts") {
        const project = db.normalizeProject(url.searchParams.get("project"));
        return send(res, 200, {
          prompts: db.list({
            project: project || undefined,
            status: url.searchParams.get("status") || undefined,
          }),
        });
      }

      if (req.method === "POST" && pathname === "/api/prompts") {
        let data;
        try {
          data = await readBody(req);
        } catch (err) {
          return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
        }
        try {
          return send(res, 201, { prompt: db.add({ project: data.project, text: data.text }) });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }

      if (req.method === "POST" && pathname === "/api/reorder") {
        let data;
        try {
          data = await readBody(req);
        } catch (err) {
          return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
        }
        if (!Array.isArray(data.ids)) return send(res, 400, { error: "ids must be an array" });
        try {
          db.reorder(data.ids);
          return send(res, 200, { ok: true });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }

      const match = pathname.match(/^\/api\/prompts\/(\d+)$/);
      if (match) {
        const id = Number(match[1]);
        if (req.method === "DELETE") {
          return send(res, 200, { ok: true, removed: db.remove(id) });
        }
        if (req.method === "PATCH") {
          let data;
          try {
            data = await readBody(req);
          } catch (err) {
            return send(res, err.code === "TOO_LARGE" ? 413 : 400, { error: err.message });
          }
          try {
            let prompt = db.get(id);
            if (!prompt) return send(res, 404, { error: `no prompt with id ${id}` });
            if (typeof data.text === "string") prompt = db.edit(id, data.text);
            if (typeof data.project === "string") prompt = db.move(id, data.project);
            if (typeof data.status === "string") prompt = db.setStatus(id, data.status);
            return send(res, 200, { prompt });
          } catch (err) {
            return send(res, 400, { error: err.message });
          }
        }
      }

      if (pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
      if (req.method === "GET") return serveStatic(res, pathname);
      return send(res, 404, { error: "not found" });
    } catch (err) {
      // Last-resort catch-all so a bug never hangs a request or kills the server.
      console.error("[prompt-vault] unhandled error:", err);
      if (!res.headersSent) send(res, 500, { error: "internal server error" });
    }
  });
}

export function listen(port) {
  const server = createServer(port);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      // Another instance already serves this port — that is success, not a crash.
      console.error(`[prompt-vault] port ${port} already in use — assuming another vault is running`);
      process.exit(0);
    }
    console.error("[prompt-vault] server error:", err);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.error(`[prompt-vault] listening on http://127.0.0.1:${port}`);
  });
  return server;
}
