/**
 * Capability 6 · Readings file. The field's readings, one JSON line each, in one file in the app's home (ADR-1001 D4): appended a
 * batch at a time, the oldest dropped past 30 days or 5 MB. Nothing is sent anywhere and nothing is written to the library.
 */
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { LagReading } from "./bridge.js";

/** A reading as kept: when the app received it and which version of the app took it. */
export type KeptReading = LagReading & { at: string; version: string };

/** How much is kept: 30 days, 5 MB. */
export const KEEP = { ageMs: 30 * 86_400_000, bytes: 5 * 1024 * 1024 };

/** The storytree 0.3 home: STORYTREE_HOME, else ~/.storytree/0.3. */
export const storytreeHome = (): string => process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3");

/** The readings file in `home`. */
export const lagFile = (home: string): string => path.join(home, "lag-readings.jsonl");

/** A kept reading from one line, or undefined for a torn or foreign line. */
function parse(line: string): KeptReading | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isReading(value) && typeof (value as KeptReading).at === "string" && typeof (value as KeptReading).version === "string" ? value as KeptReading : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `value` has a reading's shape: what the page sends is checked before it is kept. */
export function isReading(value: unknown): value is LagReading {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const ms = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return typeof r.name === "string" && r.name.length > 0 && r.name.length <= 100 && ms(r.response) && ms(r.longFrames) && ms(r.longestFrame) && ms(r.settled)
    && typeof r.progress === "boolean" && (r.size === undefined || ms(r.size));
}

/** The readings kept in `home`, oldest first; none when there is no file. */
export function readReadings(home: string): KeptReading[] {
  const file = lagFile(home);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => parse(line) ?? []);
}

/** The time of the file's first line, read without reading the whole file. */
async function oldest(file: string): Promise<number | undefined> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    const at = parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0]!)?.at;
    return at === undefined ? undefined : Date.parse(at);
  } finally {
    await handle.close();
  }
}

/** The file's last byte as a character, or undefined when it is empty. */
async function lastCharacter(file: string): Promise<string | undefined> {
  const size = (await stat(file)).size;
  if (size === 0) return undefined;
  const handle = await open(file, "r");
  try {
    const { buffer } = await handle.read(Buffer.alloc(1), 0, 1, size - 1);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Rewrite the file with the newest whole lines within `keep`'s age and size. */
async function prune(file: string, keep: typeof KEEP, now: number): Promise<void> {
  const lines = (await readFile(file, "utf8")).split("\n").filter((line) => {
    const reading = parse(line);
    return reading !== undefined && Date.parse(reading.at) >= now - keep.ageMs;
  });
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines.reverse()) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > keep.bytes) break;
    kept.unshift(line);
  }
  const next = `${file}.next`;
  await writeFile(next, kept.map((line) => `${line}\n`).join(""));
  await rename(next, file);
}

/** Append `readings`, stamped with `version` and `now`, then drop the oldest past `keep`. */
export async function appendReadings(home: string, readings: readonly LagReading[], options: { version: string; now: number; keep?: typeof KEEP }): Promise<void> {
  if (readings.length === 0) return;
  const file = lagFile(home);
  const keep = options.keep ?? KEEP;
  await mkdir(home, { recursive: true });
  const at = new Date(options.now).toISOString();
  const lines = readings.map((reading) => JSON.stringify({ at, version: options.version, ...reading })).join("\n") + "\n";
  // A torn last line from a stopped app is not glued to the first new one.
  const torn = existsSync(file) && !["\n", undefined].includes(await lastCharacter(file));
  await appendFile(file, torn ? `\n${lines}` : lines);
  const first = await oldest(file);
  if ((await stat(file)).size > keep.bytes || first === undefined || first < options.now - keep.ageMs) await prune(file, keep, options.now);
}
