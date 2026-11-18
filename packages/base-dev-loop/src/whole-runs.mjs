// Capability 7 · Whole-run times measured
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { availableParallelism, homedir, hostname, loadavg } from "node:os";
import path from "node:path";

export const GATE_RUN_ENV = "STORYTREE_GATE_RUN";

export const storytreeHome = () => process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3");

const wholeRunsFile = (home) => path.join(home, "whole-runs.jsonl");

export function startClock() {
  return { started: Date.now(), load: loadavg()[0] };
}

export function wholeRunRow(kind, clock, fields) {
  const ended = Date.now();
  return { kind, at: new Date(ended).toISOString(), ms: ended - clock.started, ...fields, machine: hostname(), load: clock.load, cpus: availableParallelism(), platform: process.platform, arch: process.arch };
}

export function appendWholeRun(row, { home = storytreeHome(), log = console.log } = {}) {
  try {
    mkdirSync(home, { recursive: true });
    appendFileSync(wholeRunsFile(home), `${JSON.stringify(row)}\n`);
  } catch (error) {
    log(`${row.kind}: could not add this run's time to whole-runs.jsonl in ${home}: ${error.message}`);
  }
}

export function readWholeRuns(home = storytreeHome()) {
  let text;
  try {
    text = readFileSync(wholeRunsFile(home), "utf8");
  } catch {
    return [];
  }
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}
