// Capability 14 · Reading the doors' use
import type { Line, LineKind } from "@storytree/library";

import { countDoors, type Declared, type DoorLine, type Reading } from "./reading.js";
import { LEARN_DAYS, learnedTargets } from "./repoint.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DoorsLog {
  lines(project: string, filter: { readonly kinds: readonly LineKind[]; readonly since?: string; readonly sessions?: readonly string[]; readonly omit?: readonly string[]; readonly where?: Readonly<Record<string, string>>; readonly newest?: number; readonly latestBy?: readonly string[] }): Promise<Line[]>;
}

export async function readDoors(log: DoorsLog, project: string, declared: Declared, until: Date, days: readonly number[]): Promise<Reading[]> {
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

const LEARN_SESSIONS = 200;

export async function readLearned(log: DoorsLog, project: string, where: string, word: string, until: Date): Promise<{ verb: string; count: number }[]> {
  const since = new Date(until.getTime() - LEARN_DAYS * DAY_MS).toISOString();
  const refusals = await log.lines(project, { kinds: ["door-answered"], since, where: { door: "command", outcome: "unknown", verb: where, word }, newest: LEARN_SESSIONS });
  const sessions = [...new Set(refusals.map((line) => line.session))];
  if (sessions.length === 0) return [];
  const lines = (await log.lines(project, { kinds: ["door-answered"], since, sessions })).flatMap((line) => doorLineOf(line) ?? []);
  return learnedTargets(lines, where, word);
}

export async function readPointer(log: DoorsLog, project: string, where: string, word: string): Promise<string | undefined> {
  const [latest] = await log.lines(project, { kinds: ["door-pointer"], where: { where, word }, newest: 1 });
  return latest?.kind === "door-pointer" ? latest.to : undefined;
}

export function doorLineOf(line: Line): DoorLine | undefined {
  if (line.kind !== "door-answered") return undefined;
  const { session, at, harness, machine, door, verb, outcome, word, named, next, pointedFrom } = line;
  return {
    session, at: new Date(at).toISOString(), door, verb, outcome, next,
    ...(harness === undefined ? {} : { harness }),
    ...(machine === undefined ? {} : { machine }),
    ...(word === undefined ? {} : { word }),
    ...(named === undefined ? {} : { named }),
    ...(line.class === undefined ? {} : { class: line.class }),
    ...(pointedFrom === undefined ? {} : { pointedFrom }),
  };
}
