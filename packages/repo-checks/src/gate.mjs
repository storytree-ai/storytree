// Capability 8 · Storytree's own test and gate entries
import path from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "@storytree/base-dev-loop/provision-worktree";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export async function runGate({ root = repoRoot, guidance = false, provision = () => 0, hold, stopped = () => false, log = console.log, ...options } = {}) {
  const unready = provision(log) === 0 ? null : "worktree not installed: see the line above";
  let base;
  try {
    base = await import("@storytree/base-dev-loop");
  } catch (error) {
    if (!unready) throw error;
    log(`\ngate: no check ran: ${unready}`);
    return 1;
  }
  const release = unready ? () => {} : await (hold ?? base.contributedHold({ root, log }))({ root, what: "pnpm gate", stopped });
  try {
    return await base.runGate({
      root,
      log,
      ...options,
      flags: { guidance },
      rerunHint: `rerun: pnpm ${guidance ? "run gate --guidance" : "gate"}`,
      prepare: () => unready,
    });
  } finally {
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.find((arg) => !["--guidance", "--help"].includes(arg));
  if (unknown) {
    console.error(`gate: unknown argument ${unknown}; use pnpm run gate --help`);
    process.exitCode = 1;
  } else if (args.includes("--help")) {
    console.log("pnpm run gate [--guidance]\nRuns typecheck and scoped tests, then the steps parts contribute: in this checkout, the lint step (type-only imports between stories, package boundaries, source files no numbered test reaches), seed records, leaks added to changed files, and the capability list when the branch names an increment; with Mick's factory plugin named (storytree settings set module micks-dev-loop plugin micks-dev-loop), guidance when generated roles changed, its plan edges and owner applies too.\nUse --guidance after editing a role or a note in the library, even if Git has no diff.");
  } else {
    const controller = new AbortController();
    const force = new AbortController();
    const stop = () => controller.signal.aborted ? force.abort() : controller.abort();
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
    for (const signal of signals) process.on(signal, stop);
    try {
      process.exitCode = await runGate({ guidance: args.includes("--guidance"), provision: (log) => check({ root: repoRoot, log }), stopped: () => controller.signal.aborted, signal: controller.signal, forceSignal: force.signal });
    } catch (error) {
      console.error(`gate: ${error.message}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      for (const signal of signals) process.removeListener(signal, stop);
    }
  }
}
