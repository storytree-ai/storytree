// Capability 7 · The gate. ADR-0716: one foreground command for the checks before landing. Tests keep their own
// scoping, per-package table and rerun record in test.mjs. No second test runner lives here.
// ADR-1170 D1: the runner is the base dev loop's (packages/base-dev-loop): typecheck and the project's tests, then
// every step a part contributes. This is storytree's own `pnpm gate` around it: the repository's own checks add their steps
// (packages/repo-checks), Mick's factory plugin micks-dev-loop adds its own while this computer names it (the guidance
// check among them, ADR-1192 D2), and --guidance reaches that step's `when`.
// Flags go as `pnpm run gate --guidance`: Windows PowerShell 5.1 drops a bare `--` before pnpm
// sees it, so `pnpm gate -- --guidance` fails there; `pnpm run` passes them on in every shell.
// The gate holds the machine's heavy-run lock (packages/dev-loop/src/heavy-lock.mjs) for its whole run, so
// concurrent sessions' gates queue; its test step runs under that hold.
// Before its first check it installs a worktree no session-start hook installed (a pool lane makes its
// own with storytree workspace), as `pnpm storytree` does; one its install cannot fix runs no check (7.5).
// It starts under plain node in a worktree that may not be installed yet, so it loads the base dev loop only after.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { check } from "@storytree/base-dev-loop/provision-worktree";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** The base gate over this checkout: `provision` returns 0 once the worktree is installed, and `guidance` asks for that check. */
export async function runGate({ root = repoRoot, guidance = false, provision = () => 0, log = console.log, ...options } = {}) {
  const unready = provision(log) === 0 ? null : "worktree not installed: see the line above";
  let base;
  try {
    base = await import("@storytree/base-dev-loop");
  } catch (error) {
    if (!unready) throw error;
    log(`\ngate: no check ran: ${unready}`);
    return 1;
  }
  return base.runGate({
    root,
    log,
    ...options,
    flags: { guidance },
    rerunHint: `rerun: pnpm ${guidance ? "run gate --guidance" : "gate"}`,
    prepare: () => unready,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.find((arg) => !["--guidance", "--help"].includes(arg));
  if (unknown) {
    console.error(`gate: unknown argument ${unknown}; use pnpm run gate --help`);
    process.exitCode = 1;
  } else if (args.includes("--help")) {
    console.log("pnpm run gate [--guidance]\nRuns typecheck and scoped tests, then the steps parts contribute: in this checkout, type-only imports between stories, seed records, leaks added to changed files, and the capability list when the branch names an increment; with Mick's factory plugin named (storytree settings set part micks-dev-loop plugin micks-dev-loop), guidance when generated roles changed, its plan edges, owner applies and the change's risk line too.\nUse --guidance after editing a role or a note in the library, even if Git has no diff.");
  } else {
    const controller = new AbortController();
    const force = new AbortController();
    const stop = () => controller.signal.aborted ? force.abort() : controller.abort();
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
    for (const signal of signals) process.on(signal, stop);
    let release;
    try {
      release = await acquireHeavyLock({ root: repoRoot, what: "pnpm gate", stopped: () => controller.signal.aborted });
      process.exitCode = await runGate({ guidance: args.includes("--guidance"), provision: (log) => check({ root: repoRoot, log }), signal: controller.signal, forceSignal: force.signal });
    } catch (error) {
      console.error(`gate: ${error.message}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      release?.();
      for (const signal of signals) process.removeListener(signal, stop);
    }
  }
}
