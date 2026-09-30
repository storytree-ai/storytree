// ADR-0716: one foreground command for the checks before landing. Tests keep their own
// scoping, per-package table and rerun record in test.mjs. No second test runner lives here.
// Library edits are not Git edits: --guidance declares a role/note edit even when regeneration
// left the committed files unchanged. A hand-written CLAUDE.md header edit alone is not one.
// Flags go as `pnpm run gate --guidance`: Windows PowerShell 5.1 drops a bare `--` before pnpm
// sees it, so `pnpm gate -- --guidance` fails there; `pnpm run` passes them on in every shell.
// The gate holds the machine's heavy-run lock (packages/dev-loop/src/heavy-lock.mjs) for its whole run, so
// concurrent sessions' gates queue; its test step runs under that hold.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { REGION_START, REGION_END, ROLE_DIRS } from "./guidance.mjs";
import { changedFiles, resultsTable } from "./test-scope.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Check generated roles automatically; require the check when Git cannot establish the changes. */
export function guidanceFor(root, requested = false) {
  if (requested) return { run: true, reason: "--guidance declares a role or note change in the library" };
  try {
    const files = changedFiles(root);
    const role = files.find((file) => file === "AGENTS.md" || Object.keys(ROLE_DIRS).some((dir) => file.startsWith(`${dir}/`)));
    if (role) return { run: true, reason: `${role} changed` };
    if (files.includes("CLAUDE.md")) {
      const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const base = git("merge-base", "origin/main", "HEAD").trim();
      const before = generatedRegion(git("show", `${base}:CLAUDE.md`));
      const after = generatedRegion(readFileSync(path.join(root, "CLAUDE.md"), "utf8"));
      if (before !== after) return { run: true, reason: "CLAUDE.md's generated role changed" };
    }
    return { run: false, reason: "no role or note change detected; use --guidance for library-only edits" };
  } catch {
    return { run: true, reason: "guidance changes could not be read; checking conservatively" };
  }
}

function generatedRegion(text) {
  text = text.replaceAll("\r\n", "\n");
  const start = text.indexOf(REGION_START);
  const end = text.indexOf(REGION_END, start);
  if (start === -1 || end === -1) throw new Error("missing generated guidance markers");
  return text.slice(start, end + REGION_END.length);
}

/** Continue after ordinary failures, but never report an interrupted check as a pass. */
export async function runGate({ root = repoRoot, guidance = false, signal, forceSignal, log = console.log, run = runCheck } = {}) {
  const decision = guidanceFor(root, guidance);
  const results = { typecheck: "not run", test: "not run", "check:guidance": "not run" };
  const reasons = { "check:guidance": decision.reason };
  for (const step of Object.keys(results)) {
    if (signal?.aborted) break;
    if (step === "check:guidance" && !decision.run) continue;
    log(`\n=== ${step} ===`);
    try {
      const code = await run(step, { root, signal, forceSignal });
      if (!signal?.aborted) {
        results[step] = code === 0 ? "pass" : "fail";
        if (code !== 0) reasons[step] = `exit ${code ?? "without a code"}`;
      }
    } catch (error) {
      if (!signal?.aborted) {
        results[step] = "fail";
        reasons[step] = error.message;
      }
    }
  }
  if (signal?.aborted) {
    for (const step of Object.keys(results)) {
      if (results[step] === "not run") reasons[step] = "interrupted";
    }
  }
  const code = signal?.aborted ? 130 : Object.values(results).includes("fail") ? 1 : 0;
  const rerunHint = code === 0 ? null : `rerun: pnpm ${guidance ? "run gate --guidance" : "gate"}`;
  log(`\n${resultsTable(results, { reasons, rerunHint })}`);
  return code;
}

function runCheck(step, { root, signal, forceSignal }) {
  let command = process.execPath;
  let args;
  let shell = false;
  if (step === "test") args = ["--import", "tsx", "packages/dev-loop/src/test.mjs"];
  else if (step === "check:guidance") args = ["--import", "tsx", "packages/dev-loop/src/build-guidance.mjs", "--check"];
  else if (process.env.npm_execpath) args = [process.env.npm_execpath, "run", "typecheck"];
  else {
    command = "pnpm";
    args = ["run", "typecheck"];
    shell = process.platform === "win32"; // the .cmd shim needs a shell; every argument is fixed
  }
  return new Promise((resolve, reject) => {
    // A separate Unix process group lets cancellation reach pnpm's compiler descendants.
    // This is still foreground work: inherited stdio, no unref, and always awaited.
    const windows = process.platform === "win32";
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell, detached: !windows });
    const terminate = (signal) => {
      if (!child.pid) return;
      try {
        if (windows) execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-child.pid, signal);
      } catch (error) {
        // The process may have finished between receiving the signal and forwarding it.
        if (error.code !== "ESRCH" && child.exitCode === null) child.kill(signal);
      }
    };
    const stop = () => terminate("SIGINT"); // the test/guidance runners stop their Postgres on Ctrl-C
    const force = () => terminate("SIGKILL");
    signal?.addEventListener("abort", stop, { once: true });
    forceSignal?.addEventListener("abort", force, { once: true });
    if (signal?.aborted) stop();
    child.once("error", reject);
    child.once("close", (code) => {
      // A child can exit before a descendant that ignored the first signal.
      if (signal?.aborted && !windows) force();
      signal?.removeEventListener("abort", stop);
      forceSignal?.removeEventListener("abort", force);
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.find((arg) => !["--guidance", "--help"].includes(arg));
  if (unknown) {
    console.error(`gate: unknown argument ${unknown}; use pnpm run gate --help`);
    process.exitCode = 1;
  } else if (args.includes("--help")) {
    console.log("pnpm run gate [--guidance]\nRuns typecheck, scoped tests and guidance when generated roles changed.\nUse --guidance after editing a role or a note in the library, even if Git has no diff.");
  } else {
    const controller = new AbortController();
    const force = new AbortController();
    const stop = () => controller.signal.aborted ? force.abort() : controller.abort();
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
    for (const signal of signals) process.on(signal, stop);
    let release;
    try {
      release = await acquireHeavyLock({ root: repoRoot, what: "pnpm gate", stopped: () => controller.signal.aborted });
      process.exitCode = await runGate({ guidance: args.includes("--guidance"), signal: controller.signal, forceSignal: force.signal });
    } catch (error) {
      console.error(`gate: ${error.message}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      release?.();
      for (const signal of signals) process.removeListener(signal, stop);
    }
  }
}
