/**
 * Capability 4 · Sessions, a machine's start (contract 4.29): a session killed by its machine's
 * restart writes no end line, so every reader, on every machine, needs to know when that machine
 * last started. The first hook on a machine to reach a project's log after each start writes it
 * there, once: a "machine-started" line, with the start by the machine's own clock. This machine
 * remembers, under the storytree home, the start it last recorded in each project.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ActivityLog, Line } from "../activity/index.js";
import { thisRestart } from "../claims/claims.js";
import type { Restart } from "../readings.js";

/** How far apart two readings of one start may lie: a start is read from the machine's uptime, to within a second or so. */
const SAME_START_MS = 60_000;

/** Who records the start: the session whose hook reached the log. */
export interface Recorder {
  readonly session: string;
  readonly harness?: string;
}

/**
 * Record in `project`'s log that this machine started at `started`, unless this machine already
 * recorded that start there: the line written, or undefined when there was nothing to write.
 */
export async function recordMachineStart(home: string, log: ActivityLog, project: string, by: Recorder, started: Restart | undefined = thisRestart()): Promise<Line | undefined> {
  if (started === undefined) return undefined;
  const file = path.join(home, "machine-started.json");
  const recorded = readRecorded(file);
  const last = Date.parse(recorded[project] ?? "");
  if (Math.abs(last - started.at.getTime()) < SAME_START_MS) return undefined;
  const line = await log.append(project, {
    session: by.session,
    ...(by.harness === undefined ? {} : { harness: by.harness }),
    source: "hook",
    kind: "machine-started",
    machine: started.machine,
    startedAt: started.at.toISOString(),
  });
  mkdirSync(home, { recursive: true });
  writeFileSync(file, JSON.stringify({ ...recorded, [project]: started.at.toISOString() }));
  return line;
}

/** The start this machine last recorded in each project, by project. */
function readRecorded(file: string): Record<string, string> {
  try {
    const recorded: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof recorded === "object" && recorded !== null ? (recorded as Record<string, string>) : {};
  } catch {
    return {};
  }
}
