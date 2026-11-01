// Capability 1 · The gate runner. ADR-1170 D1, D2: the base dev loop's one foreground command for the checks before
// landing. It runs its base steps (the project's typecheck and tests) and then every step a part contributes as
// `gateSteps` in its storytree manifest, each in the same PASS / FAIL / NOT RUN table; a step whose part this computer
// switches off is NOT RUN with why, and a factory plugin this computer names for a part it switches off, or for a part
// it adds, has its steps run in that part's place (one that cannot be loaded is NOT RUN with why). A step is `{ name, when?, command }`: `when({ root, ...flags })` says whether it
// runs and the reason its row shows (absent, it always runs, with no reason), and `command({ root })` the process it
// runs from the project's root. A part may also hold the project's heavy runs, contributing `runHolds` the same way
// (contributedHold), which a project's own test and gate commands take. It runs in a user's project as in storytree's own,
// whose own entries (packages/repo-checks) wrap it with its worktree install and the holds its parts contribute.
// It starts under plain node, so it reads the contributed steps (TypeScript parts) through tsx.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

let loaded;
/** The project's TypeScript parts, read through tsx (registered once): the gate starts under plain node. */
function typescript() {
  return loaded ??= (async () => {
    const { register } = await import("tsx/esm/api");
    register();
    const [loader, settings] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
    return { ...loader, readPartsOff: settings.readPartsOff, readStandIns: settings.readStandIns };
  })();
}

/** The contributions of `kind` the parts `root`'s package.json depends on declare, with the part each came from. */
async function contributed(root, kind) {
  return (await typescript()).composeParts(path.join(root, "package.json"), kind);
}

/** The gate steps the parts `root`'s package.json depends on contribute, with the part each came from. */
export const contributedSteps = (root) => contributed(root, "gateSteps");

const readPartsOff = async () => (await typescript()).readPartsOff();
const readStandIns = async () => (await typescript()).readStandIns();
const BASE = ["typecheck", "test"];
// The row that stands for the contributed steps when they could not be read.
const CONTRIBUTED = "contributed steps";

/**
 * The contributions of `kind` in `composition` that run on this computer, each with its owner and, for a part this
 * computer switches off, why (`off`): a factory plugin's run only in the place this computer names for it, its part
 * switched off or a part it adds; one named there that could not be loaded is in `failed`, by the plugin's name, with why.
 */
export async function place(composition, kind, { partsOff = readPartsOff, standIns = readStandIns } = {}) {
  const named = await standIns();
  const { standIn } = await import("@storytree/plugin-loader");
  const composed = standIn(composition, kind, named);
  const { offSaid, standInPlaces, switchedOff } = await import("@storytree/plugin-loader/switch");
  const parts = await partsOff();
  const off = switchedOff(composed.graph, parts);
  const places = standInPlaces(composed.graph, parts);
  const standsIn = composed.standsIn ?? {};
  const failed = {};
  for (const [part, why] of Object.entries(composed.failed ?? {})) {
    if (places.has(part)) failed[named.plugins[part]] = why;
  }
  const placed = [];
  composed.parts.forEach((part, index) => {
    const owner = composed.owners[index];
    if (Object.hasOwn(standsIn, owner) && !places.has(standsIn[owner])) return;
    placed.push({ part, owner, ...(off.has(owner) ? { off: offSaid({ part: owner, because: off.get(owner) }) } : {}) });
  });
  return { placed, failed };
}

/**
 * The hold a project's parts put on its heavy runs: each `runHolds` contribution `{ name, take({ root, what, stopped }) }`
 * placed on this computer as gate steps are (`place`), taken in order and released in reverse, so the caller's run waits
 * until every one is taken. Its `take` resolves to the release of all it took; with none placed it takes nothing. A
 * contribution that could not be read, or a plugin that could not be loaded, is said with why and holds nothing.
 */
export function contributedHold({ root = process.cwd(), compose = (at) => contributed(at, "runHolds"), partsOff = readPartsOff, standIns = readStandIns, log = console.log } = {}) {
  return async (options) => {
    let holds = [];
    try {
      const { placed, failed } = await place(await compose(root), "runHolds", { partsOff, standIns });
      for (const [plugin, why] of Object.entries(failed)) log(`run holds: ${plugin} holds nothing: ${why}`);
      holds = placed.filter(({ off }) => !off).map(({ part }) => part);
    } catch (error) {
      log(`run holds: none taken, since the parts' run holds could not be read: ${error.message}`);
    }
    const releases = [];
    const release = () => {
      for (const one of releases.splice(0).reverse()) one();
    };
    try {
      for (const hold of holds) releases.push(await hold.take(options));
    } catch (error) {
      release();
      throw error;
    }
    return release;
  };
}

/**
 * Run the base steps, then the contributed ones; continue after ordinary failures, but never report an interrupted
 * check as a pass. `prepare(log)` runs before the first check and returns why no check can run, or nothing when ready.
 * `flags` reach each contributed step's `when`; `rerunHint` is printed under a table that is not all PASS.
 */
export async function runGate({ root = process.cwd(), flags = {}, rerunHint = null, signal, forceSignal, log = console.log, run = runCheck, prepare = () => null, steps = contributedSteps, partsOff = readPartsOff, standIns = readStandIns } = {}) {
  const unready = prepare(log);
  const results = Object.fromEntries(BASE.map((step) => [step, "not run"]));
  const reasons = {};
  const planned = BASE.map((name) => ({ name, command: () => stepCommand(name) }));
  if (unready) {
    results[CONTRIBUTED] = "not run";
    for (const step of Object.keys(results)) reasons[step] = unready;
    planned.length = 0;
  } else {
    try {
      const { placed, failed } = await place(await steps(root), "gateSteps", { partsOff, standIns });
      for (const [plugin, why] of Object.entries(failed)) {
        results[plugin] = "not run";
        reasons[plugin] = why;
      }
      for (const { part: step, off } of placed) {
        results[step.name] = "not run";
        if (off) {
          reasons[step.name] = off;
          continue;
        }
        const decision = step.when?.({ root, ...flags }) ?? { run: true };
        if (decision.reason) reasons[step.name] = decision.reason;
        if (decision.run) planned.push(step);
      }
    } catch (error) {
      results[CONTRIBUTED] = "fail";
      reasons[CONTRIBUTED] = `could not be read: ${error.message}`;
    }
  }
  for (const step of planned) {
    if (signal?.aborted) break;
    log(`\n=== ${step.name} ===`);
    try {
      const code = await run(step.name, { root, signal, forceSignal, command: step.command({ root }) });
      if (!signal?.aborted) {
        results[step.name] = code === 0 ? "pass" : "fail";
        if (code !== 0) reasons[step.name] = `exit ${code ?? "without a code"}`;
      }
    } catch (error) {
      if (!signal?.aborted) {
        results[step.name] = "fail";
        reasons[step.name] = error.message;
      }
    }
  }
  if (signal?.aborted) {
    for (const step of Object.keys(results)) {
      if (results[step] === "not run") reasons[step] = "interrupted";
    }
  }
  const code = signal?.aborted ? 130 : unready || Object.values(results).includes("fail") ? 1 : 0;
  log(`\n${resultsTable(results, { reasons, rerunHint: code === 0 ? null : rerunHint })}`);
  return code;
}

/** The PASS / FAIL / NOT RUN table: one row per unit with its reason, and `rerunHint` under it when any is not PASS. */
export function resultsTable(results, { reasons = {}, rerunHint = null } = {}) {
  const label = { pass: "PASS", fail: "FAIL", "not run": "NOT RUN" };
  const rows = Object.entries(results).map(([unit, result]) => `  ${label[result].padEnd(8)}${unit}${reasons[unit] ? ` — ${reasons[unit]}` : ""}`);
  const failed = Object.values(results).some((result) => result !== "pass");
  return ["results:", ...rows, ...(failed && rerunHint ? [rerunHint] : [])].join("\n");
}

/** The command a base step runs: the project's own script of that name. */
export function stepCommand(step) {
  if (process.env.npm_execpath) return { command: process.execPath, args: [process.env.npm_execpath, "run", step], shell: false };
  // the .cmd shim needs a shell; every argument is fixed
  return { command: "pnpm", args: ["run", step], shell: process.platform === "win32" };
}

function runCheck(step, { root, signal, forceSignal, command: { command, args, shell } }) {
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
    const stop = () => terminate("SIGINT"); // the test runners stop their databases on Ctrl-C
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

// Run as `node <this file>` in a project's root; it takes no arguments.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A first interrupt stops the running check, a second kills it.
  const controller = new AbortController();
  const force = new AbortController();
  const stop = () => controller.signal.aborted ? force.abort() : controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
  for (const signal of signals) process.on(signal, stop);
  try {
    process.exitCode = await runGate({ signal: controller.signal, forceSignal: force.signal });
  } catch (error) {
    console.error(`gate: ${error.message}`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    for (const signal of signals) process.removeListener(signal, stop);
  }
}
