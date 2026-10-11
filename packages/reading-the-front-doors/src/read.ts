/**
 * Capability 1 · The reading. A project's door-answered lines for the longest window asked, read once from its activity log and
 * narrowed on the server by kind and time (Session management 2.7), with the prompts of the sessions
 * in it; each window is then counted from those lines.
 */
import type { ActivityLog, Line } from "@storytree/session-management";

import { countDoors, type Declared, type DoorLine, type Reading } from "./reading.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One reading for each of `days`, each the window of that many days ending at `until`. */
export async function readDoors(log: ActivityLog, project: string, declared: Declared, until: Date, days: readonly number[]): Promise<Reading[]> {
  const end = until.toISOString();
  const earliest = new Date(until.getTime() - Math.max(...days) * DAY_MS).toISOString();
  const lines = (await log.lines(project, { kinds: ["door-answered"], since: earliest })).flatMap((line) => {
    const door = doorLineOf(line);
    return door === undefined || door.at >= end ? [] : [door];
  });
  const sessions = [...new Set(lines.map((line) => line.session))];
  const prompts = new Map<string, number>();
  if (sessions.length > 0) {
    for (const line of await log.lines(project, { kinds: ["prompt-submitted"], sessions, omit: ["transcript"] })) prompts.set(line.session, (prompts.get(line.session) ?? 0) + 1);
  }
  return days.map((count) => {
    const since = new Date(until.getTime() - count * DAY_MS).toISOString();
    return countDoors(lines.filter((line) => line.at >= since), declared, prompts, { since, until: end });
  });
}

function doorLineOf(line: Line): DoorLine | undefined {
  if (line.kind !== "door-answered") return undefined;
  const { session, at, harness, machine, door, verb, outcome, word, named, next } = line;
  return {
    session, at: new Date(at).toISOString(), door, verb, outcome, next,
    ...(harness === undefined ? {} : { harness }),
    ...(machine === undefined ? {} : { machine }),
    ...(word === undefined ? {} : { word }),
    ...(named === undefined ? {} : { named }),
    ...(line.class === undefined ? {} : { class: line.class }),
  };
}
