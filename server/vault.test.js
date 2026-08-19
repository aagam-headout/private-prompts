// Run with `npm test` (node --test server/). Everything here is in-process: a
// throwaway PV_DATA_DIR for the database and an ephemeral port for the server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { silenceSqliteWarning } from "./quiet.js";

silenceSqliteWarning();

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-vault-test-"));
process.env.PV_DATA_DIR = DATA_DIR;

// Both modules read PV_DATA_DIR at import time, so the env has to be set first.
const db = await import("./db.js");
const { createServer } = await import("./server.js");

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), "pv-project-"));

function reset() {
  db.open().exec("DELETE FROM prompts");
}

test("normalizeProject agrees however the path is written", () => {
  const real = fs.realpathSync(PROJECT);
  assert.equal(db.normalizeProject(PROJECT), real);
  assert.equal(db.normalizeProject(`${PROJECT}/`), real);
  assert.equal(db.normalizeProject(`  ${PROJECT}//  `), real);
  assert.equal(db.normalizeProject(""), "");
  assert.equal(db.normalizeProject(null), "");
  // A path that no longer exists still has to hash to something stable.
  assert.equal(db.normalizeProject("/nope/gone/"), "/nope/gone");
});

test("a subdirectory of a repository resolves to the repository root", () => {
  reset();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pv-repo-")));
  const sub = path.join(root, "packages", "app");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(root, ".git"));
  try {
    assert.equal(db.repoRoot(sub), root);
    assert.equal(db.projectFor(sub), root);
    // A prompt queued from the root is what an agent in the subdirectory claims.
    db.add({ project: root, text: "from the root" });
    const claimed = db.claim(db.projectFor(sub), 1);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].text, "from the root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a queue already keyed to a subdirectory keeps its prompts", () => {
  reset();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pv-legacy-")));
  const sub = path.join(root, "web");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(root, ".git"));
  try {
    db.add({ project: sub, text: "queued before walk-up existed" });
    assert.equal(db.projectFor(sub), sub);
    assert.equal(db.claim(db.projectFor(sub), 1)[0].text, "queued before walk-up existed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeProject uses the on-disk spelling of a path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-Case-"));
  try {
    const canonical = db.normalizeProject(dir);
    // Only meaningful where the filesystem is case-insensitive; elsewhere the
    // shouted path does not exist and normalizeProject keeps it verbatim.
    const shouted = db.normalizeProject(dir.toUpperCase());
    if (fs.existsSync(dir.toUpperCase())) assert.equal(shouted, canonical);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("requeueStalled hands claimed prompts back, this project only", () => {
  reset();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pv-other-")));
  try {
    db.add({ project: PROJECT, text: "mine" });
    db.add({ project: other, text: "theirs" });
    db.claim(PROJECT, -1);
    db.claim(other, -1);
    const back = db.requeueStalled(PROJECT);
    assert.deepEqual(back.map((p) => p.status), ["pending"]);
    assert.equal(back[0].text, "mine");
    // The other project's claim is untouched, and the requeued prompt is
    // claimable again.
    assert.equal(db.list({ project: other, status: "in_progress" }).length, 1);
    assert.equal(db.claim(PROJECT, 1)[0].text, "mine");
    assert.equal(db.requeueStalled(other).length, 1);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test("add rejects an empty prompt or a missing project", () => {
  reset();
  assert.throws(() => db.add({ project: PROJECT, text: "   " }), /empty prompt/);
  assert.throws(() => db.add({ project: "", text: "hi" }), /missing project/);
});

test("claim takes prompts in queue order and never twice", () => {
  reset();
  const ids = ["one", "two", "three"].map((text) => db.add({ project: PROJECT, text }).id);

  const first = db.claim(PROJECT, 2);
  assert.deepEqual(first.map((p) => p.id), ids.slice(0, 2));
  assert.ok(first.every((p) => p.status === "in_progress"));

  // The already-claimed two must not come back.
  const second = db.claim(PROJECT, -1);
  assert.deepEqual(second.map((p) => p.id), [ids[2]]);
  assert.deepEqual(db.claim(PROJECT, -1), []);
});

test("claim only sees its own project", () => {
  reset();
  const other = fs.realpathSync(os.tmpdir());
  db.add({ project: PROJECT, text: "mine" });
  db.add({ project: other, text: "theirs" });
  const claimed = db.claim(PROJECT, -1);
  assert.deepEqual(claimed.map((p) => p.text), ["mine"]);
});

test("reorder renumbers, and new prompts still land last", () => {
  reset();
  const ids = ["a", "b", "c"].map((text) => db.add({ project: PROJECT, text }).id);
  db.reorder([ids[2], ids[0], ids[1]]);
  assert.deepEqual(
    db.list({ project: db.normalizeProject(PROJECT) }).map((p) => p.id),
    [ids[2], ids[0], ids[1]]
  );
  const added = db.add({ project: PROJECT, text: "d" });
  assert.equal(db.claim(PROJECT, -1).at(-1).id, added.id);
});

test("requeueing sends a prompt to the back, not to where it used to be", () => {
  reset();
  const first = db.add({ project: PROJECT, text: "old" });
  db.setStatus(first.id, "done");
  const second = db.add({ project: PROJECT, text: "new" });
  db.setStatus(first.id, "pending");

  const order = db.list({ project: db.normalizeProject(PROJECT), status: "pending" });
  assert.deepEqual(order.map((p) => p.id), [second.id, first.id]);
});

test("setStatus clears done_at on the way back out of done", () => {
  reset();
  const prompt = db.add({ project: PROJECT, text: "x" });
  assert.ok(db.setStatus(prompt.id, "done").done_at > 0);
  assert.equal(db.setStatus(prompt.id, "pending").done_at, null);
  assert.throws(() => db.setStatus(prompt.id, "wat"), /unknown status/);
  assert.equal(db.setStatus(999999, "done"), null);
});

test("list caps the done pile, newest first, and -1 lifts the cap", () => {
  reset();
  const project = db.normalizeProject(PROJECT);
  const ids = [];
  for (let i = 0; i < db.DONE_LIMIT + 5; i++) {
    const prompt = db.add({ project: PROJECT, text: `p${i}` });
    db.setStatus(prompt.id, "done");
    ids.push(prompt.id);
  }
  const capped = db.list({ project });
  assert.equal(capped.length, db.DONE_LIMIT);
  assert.equal(capped[0].id, ids.at(-1)); // newest first
  assert.equal(db.list({ project, doneLimit: -1 }).length, ids.length);
  // Pending and in_progress are never capped away.
  const live = db.add({ project: PROJECT, text: "live" });
  assert.ok(db.list({ project }).some((p) => p.id === live.id));
});

// ---------- server ----------

function start() {
  const server = createServer(0);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      // The guard compares the Host header against the port it was created
      // with, so rebuild the handler now that the real port is known.
      server.close(() => {
        const real = createServer(port);
        real.listen(port, "127.0.0.1", () => resolve({ server: real, port }));
      });
    });
  });
}

function rawStatus(port, pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function withServer(fn) {
  const { server, port } = await start();
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("guard refuses foreign Host, Origin, and cross-site requests", async () => {
  await withServer(async (port) => {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);

    // fetch() refuses to set Host, so the rebinding case needs a raw request.
    assert.equal(await rawStatus(port, "/health", { host: "evil.test" }), 403);

    const origin = await fetch(`${base}/api/projects`, {
      headers: { origin: "http://evil.test" },
    });
    assert.equal(origin.status, 403);

    const crossSite = await fetch(`${base}/api/projects`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);
  });
});

test("a prompt survives the round trip with multi-byte characters intact", async () => {
  reset();
  await withServer(async (port) => {
    // Long enough to arrive in several chunks, with a 4-byte character at every
    // boundary a naive per-chunk decode would split.
    const text = "🚀 匆匆 café ".repeat(20000);
    const res = await fetch(`http://127.0.0.1:${port}/api/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: PROJECT, text }),
    });
    assert.equal(res.status, 201);
    const { prompt } = await res.json();
    assert.equal(prompt.text, text.trim());
    assert.equal(db.get(prompt.id).text, text.trim());
  });
});

test("an oversized body is refused rather than truncated", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: PROJECT, text: "x".repeat(600 * 1024) }),
    }).catch(() => null);
    // The server destroys the socket, so either a 413 or a transport error is
    // a pass — what must not happen is a silently truncated prompt.
    if (res) assert.equal(res.status, 413);
  });
});

test("unknown API routes 404 and bad writes 400", async () => {
  await withServer(async (port) => {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);

    const empty = await fetch(`${base}/api/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: PROJECT, text: "  " }),
    });
    assert.equal(empty.status, 400);

    const missing = await fetch(`${base}/api/prompts/999999`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(missing.status, 404);

    const badOrder = await fetch(`${base}/api/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: "nope" }),
    });
    assert.equal(badOrder.status, 400);
  });
});

test("static serving cannot be walked out of dist/", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/../../server/db.js`);
    const body = await res.text();
    assert.ok(!body.includes("DatabaseSync"), "served a file from outside dist/");
  });
});
