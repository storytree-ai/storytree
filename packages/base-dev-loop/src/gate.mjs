// Capability 1 · The gate runner
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendWholeRun, GATE_RUN_ENV, readWholeRuns, startClock, storytreeHome, wholeRunRow } from "./whole-runs.mjs";

let loaded;
function typescript() {
  return loaded ??= (async () => {
    const { register } = await import("tsx/esm/api");
    register();
    const [loader, settings] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
    return { ...loader, readPartsOff: settings.readPartsOff, readStandIns: settings.readStandIns };
  })();
}

async function contributed(root, kind) {
  return (await typescript()).composeParts(path.join(root, "package.json"), kind);
}

export const contributedSteps = (root) => contributed(root, "gateSteps");

const readPartsOff = async () => (await typescript()).readPartsOff();
const readStandIns = async () => (await typescript()).readStandIns();
const BASE = ["typecheck", "test"];
const CONTRIBUTED = "contributed steps";

export async function place(composition, kind, { partsOff = readPartsOff, standIns = readStandIns } = {}) {
  const named = await standIns();
  const { standIn } = await import("@storytree/plugin-loader");
  const composed = standIn(composition, kind, named);
  const { offSaid, pluginAt, standInPlaces, switchedOff } = await import("@storytree/plugin-loader/switch");
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
    const plugin = pluginAt(composed, index);
    if (plugin !== undefined && !places.has(standsIn[plugin])) return;
    placed.push({ part, owner, ...(plugin === undefined && off.has(owner) ? { off: offSaid({ part: owner, because: off.get(owner) }) } : {}) });
  });
  return { placed, failed };
}

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

export async function runGate({ root = process.cwd(), flags = {}, rerunHint = null, signal, forceSignal, log = console.log, run = runCheck, prepare = () => null, steps = contributedSteps, partsOff = readPartsOff, standIns = readStandIns, home = storytreeHome() } = {}) {
  const clock = startClock();
  const id = randomUUID();
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
      const code = await run(step.name, { root, signal, forceSignal, env: { [GATE_RUN_ENV]: id }, command: step.command({ root }) });
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
  const tested = signal?.aborted ? undefined : readWholeRuns(home).findLast((row) => row.kind === "test" && row.gate === id);
  if (tested !== undefined) appendWholeRun(wholeRunRow("gate", clock, { scope: tested.scope, units: tested.units, result: code === 0 ? "pass" : "fail" }), { home, log });
  return code;
}

export function resultsTable(results, { reasons = {}, rerunHint = null } = {}) {
  const label = { pass: "PASS", fail: "FAIL", "not run": "NOT RUN" };
  const rows = Object.entries(results).map(([unit, result]) => `  ${label[result].padEnd(8)}${unit}${reasons[unit] ? ` — ${reasons[unit]}` : ""}`);
  const failed = Object.values(results).some((result) => result !== "pass");
  return ["results:", ...rows, ...(failed && rerunHint ? [rerunHint] : [])].join("\n");
}

export function stepCommand(step) {
  if (process.env.npm_execpath) return { command: process.execPath, args: [process.env.npm_execpath, "run", step], shell: false };
  return { command: "pnpm", args: ["run", step], shell: process.platform === "win32" };
}

function runCheck(step, { root, signal, forceSignal, env, command: { command, args, shell } }) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", shell, detached: !windows });
    const terminate = (signal) => {
      if (!child.pid) return;
      try {
        if (windows) execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH" && child.exitCode === null) child.kill(signal);
      }
    };
    const stop = () => terminate("SIGINT");
    const force = () => terminate("SIGKILL");
    signal?.addEventListener("abort", stop, { once: true });
    forceSignal?.addEventListener("abort", force, { once: true });
    if (signal?.aborted) stop();
    child.once("error", reject);
    child.once("close", (code) => {
      if (signal?.aborted && !windows) force();
      signal?.removeEventListener("abort", stop);
      forceSignal?.removeEventListener("abort", force);
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
