// Capability 4 · Sessions
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ActivityLog } from "../activity/index.js";
import type { Line } from "@storytree/library";
import { thisRestart } from "../claims/claims.js";
import type { Restart } from "../readings.js";

const SAME_START_MS = 60_000;

export interface Recorder {
  readonly session: string;
  readonly harness?: string;
}

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

function readRecorded(file: string): Record<string, string> {
  try {
    const recorded: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof recorded === "object" && recorded !== null ? (recorded as Record<string, string>) : {};
  } catch {
    return {};
  }
}
