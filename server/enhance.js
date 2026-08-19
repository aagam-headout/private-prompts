// Enhance: hand a draft prompt to an installed agent CLI and get a tightened
// version back. This is the one part of the vault that leaves the machine — the
// chosen CLI sends the text to whatever model provider it is configured with.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 120000;

const REWRITE_ONLY =
  "You are rewriting a prompt, not answering it and not reviewing it. " +
  "Output only the rewritten prompt as plain text. No preamble, no commentary, " +
  "no analysis, no questions, no verdict, no markdown headings or bullets " +
  "unless the original prompt itself used them.";

export const CLI_BIN = { claude: "claude", codex: "codex", cursor: "agent" };

export const MODELS = {
  claude: {
    haiku: "claude-haiku-4-5-20251001",
    sonnet: "claude-sonnet-5",
    opus: "claude-opus-5",
    default: "Claude CLI default",
  },
  codex: { default: "configured Codex model" },
  cursor: { default: "configured Cursor model" },
};

export const DEFAULT_MODEL = { claude: "haiku", codex: "default", cursor: "default" };

export function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [cmd], (err) => resolve(!err));
  });
}

// Which CLIs are actually installed, so the picker can grey out the rest.
export async function availability() {
  const [claude, codex, cursor] = await Promise.all(
    [CLI_BIN.claude, CLI_BIN.codex, CLI_BIN.cursor].map(which)
  );
  return { claude, codex, cursor };
}

export function gitBranch(cwd) {
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
      // Not a repo, git missing, detached HEAD — all fine, just no branch badge.
      if (err) return resolve(null);
      const branch = stdout.trim();
      resolve(branch && branch !== "HEAD" ? branch : null);
    });
  });
}

// Codex writes its answer to a file rather than stdout, so it needs a scratch
// directory and cleanup on every exit path.
function runCodex(instruction, model, cwd) {
  return new Promise((resolve, reject) => {
    let tempDir;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-vault-"));
    } catch (err) {
      return reject(err);
    }
    const outputFile = path.join(tempDir, "response.txt");
    const args = [
      "exec", "--ephemeral", "--skip-git-repo-check",
      "--sandbox", "read-only", "--output-last-message", outputFile,
    ];
    if (model && model !== "default") args.push("--model", model);
    if (cwd && fs.existsSync(cwd)) args.push("--cd", cwd);

    let stderr = "";
    let finished = false;
    const finish = (err, output) => {
      if (finished) return;
      finished = true;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      err ? reject(err) : resolve(output);
    };

    const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("timed out after 120s"));
    }, TIMEOUT_MS);
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
  });
}

function runExecFile(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = err.killed ? "timed out after 120s" : (stderr || err.message).trim().slice(0, 500);
        return reject(new Error(detail));
      }
      resolve(stdout.trim());
    });
  });
}

function buildInstruction(text, context) {
  let preamble = "";
  if (context && context.include) {
    const parts = [];
    if (context.model) parts.push(`configured model: ${context.model}`);
    if (context.repo) parts.push(`project: ${context.repo}`);
    if (context.branch) parts.push(`git branch: ${context.branch}`);
    if (parts.length) {
      preamble =
        `Session context (${parts.join(", ")}) — tailor phrasing/constraints for this project where relevant.\n\n`;
    }
  }
  return (
    preamble +
    "Improve and tighten this prompt. Keep intent identical. Return only the improved prompt, no commentary:\n\n" +
    text
  );
}

export async function enhance({ text, cli, model, cwd, context }) {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw Object.assign(new Error("empty prompt — nothing to enhance"), { status: 400 });

  const chosen = CLI_BIN[cli] ? cli : "claude";
  const bin = CLI_BIN[chosen];
  if (!(await which(bin))) {
    throw Object.assign(
      new Error(`\`${bin}\` CLI not found in PATH — install it to use Enhance`),
      { status: 503 }
    );
  }

  const requested = model || DEFAULT_MODEL[chosen];
  // An unknown alias for Claude would be passed through to --model verbatim and
  // fail deep inside the CLI; fall back instead.
  const resolved =
    chosen === "claude" && !MODELS.claude[requested] ? DEFAULT_MODEL[chosen] : requested;

  const instruction = buildInstruction(body, context);
  const projectDir = context && context.include ? cwd : null;

  try {
    if (chosen === "codex") {
      return (await runCodex(instruction, resolved, projectDir)) || body;
    }
    if (chosen === "cursor") {
      const args = ["-p", "--trust", "--output-format", "text"];
      if (projectDir && fs.existsSync(projectDir)) args.push("--workspace", projectDir);
      args.push(instruction);
      return (await runExecFile("agent", args)) || body;
    }
    // Without pinning the system prompt, the user's own CLAUDE.md and skills
    // apply — a prompt-critique setup answers with questions and a verdict
    // instead of the rewritten prompt this feature is supposed to return.
    const args = ["-p", "--append-system-prompt", REWRITE_ONLY];
    if (resolved !== "default") args.push("--model", resolved);
    args.push(instruction);
    return (await runExecFile("claude", args)) || body;
  } catch (err) {
    throw Object.assign(new Error(`${bin} CLI failed: ${err.message.slice(0, 500)}`), { status: 502 });
  }
}
