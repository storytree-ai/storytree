// Capability 9 · Context readings
import { createHash, randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ActivityLog } from "../activity/index.js";
import type { Line } from "@storytree/library";
import { ContextFold, contextReading, transcriptLines, type ContextReading, type StoredAt, type TranscriptReader } from "../context/context.js";
import { sessionWindow, type SessionWindow } from "../context/window.js";

export const RETAIN_MS = 180 * 24 * 60 * 60 * 1000;

interface Kept {
  readonly context: ContextReading;
  readonly window: SessionWindow;
}

interface Held {
  readonly records: readonly string[];
  readonly finish: number;
}

interface Batch {
  readonly from: number;
  readonly finish: number;
  readonly records: readonly string[];
}

const NOTHING: Held = { records: [], finish: 0 };

const keyOf = (project: string, session: string, part: string): string => (part === "" ? `${project}\0${session}` : `${project}\0${session}\0${part}`);

export class TranscriptCache {
  readonly #dir: string | undefined;
  readonly #held = new Map<string, Promise<Held>>();
  readonly #folds = new Map<string, { fold: ContextFold; taken: number }>();

  constructor(dir?: string) {
    this.#dir = dir;
  }

  async read(log: ActivityLog, project: string, session: string, part = ""): Promise<string | undefined> {
    const now = await this.#advance(log, project, session, part);
    return now.records.length === 0 ? undefined : now.records.join("\n");
  }

  async fold(log: ActivityLog, project: string, session: string, harness: string | undefined, part = ""): Promise<ContextFold | undefined> {
    const key = keyOf(project, session, part);
    const now = await this.#advance(log, project, session, part);
    let kept = this.#folds.get(key);
    if (kept === undefined || kept.fold.harness !== harness || kept.taken > now.records.length) kept = { fold: new ContextFold(harness, { subagent: part !== "" }), taken: 0 };
    if (now.records.length > kept.taken) {
      kept.fold.feed(now.records.slice(kept.taken).join("\n"));
      kept.taken = now.records.length;
    }
    this.#folds.set(key, kept);
    return now.records.length === 0 ? undefined : kept.fold;
  }

  parsed(project: string, session: string, part = ""): number {
    return this.#folds.get(keyOf(project, session, part))?.fold.parsed ?? 0;
  }

  #advance(log: ActivityLog, project: string, session: string, part: string): Promise<Held> {
    const key = keyOf(project, session, part);
    const before = this.#held.get(key) ?? this.#load(log, project, session, part);
    const after = before.then((had) => this.#add(log, project, session, part, had));
    this.#held.set(key, after.catch(() => before));
    return after;
  }

  async forget(project: string, session: string): Promise<void> {
    this.#held.delete(`${project}\0${session}`);
    this.#folds.delete(`${project}\0${session}`);
    const file = this.#file(project, session, "");
    if (file !== undefined) await rm(file, { force: true }).catch(() => {});
  }

  #file(project: string, session: string, part: string): string | undefined {
    if (this.#dir === undefined) return undefined;
    return path.join(this.#dir, `${createHash("sha256").update(keyOf(project, session, part)).digest("hex").slice(0, 32)}.jsonl`);
  }

  async #load(log: ActivityLog, project: string, session: string, part: string): Promise<Held> {
    const file = this.#file(project, session, part);
    if (file === undefined) return NOTHING;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return NOTHING;
    }
    const records: string[] = [];
    let finish = 0;
    let dropped = false;
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const batch = parseBatch(line);
      if (batch === undefined || batch.from !== finish) {
        dropped = true;
        continue;
      }
      records.push(...batch.records);
      finish = batch.finish;
    }
    if (finish > 0 && ((await log.transcripts.cursors(project, session)).get(part) ?? 0) < finish) {
      await rm(file, { force: true }).catch(() => {});
      return NOTHING;
    }
    const held = { records, finish };
    if (dropped) await this.#write(file, held, "rewrite");
    return held;
  }

  async #add(log: ActivityLog, project: string, session: string, part: string, had: Held): Promise<Held> {
    const added = await log.transcripts.since(project, session, had.finish, part);
    if (added.records.length === 0) return had;
    const now = { records: [...had.records, ...added.records], finish: added.finish };
    const file = this.#file(project, session, part);
    if (file !== undefined) await this.#write(file, { from: had.finish, ...added }, "append");
    return now;
  }

  async #write(file: string, batch: Batch | Held, how: "append" | "rewrite"): Promise<void> {
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(file), 0o700);
      if (how === "append") {
        await appendFile(file, `${JSON.stringify(batch)}\n`, { mode: 0o600 });
        await chmod(file, 0o600);
      } else {
        const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
        await writeFile(temporary, batch.records.length === 0 ? "" : `${JSON.stringify({ from: 0, finish: batch.finish, records: batch.records })}\n`, { mode: 0o600 });
        await rename(temporary, file);
      }
    } catch {
    }
  }
}

function parseBatch(line: string): Batch | undefined {
  try {
    const value = JSON.parse(line) as Partial<Batch>;
    if (typeof value.from !== "number" || typeof value.finish !== "number" || !Array.isArray(value.records)) return undefined;
    if (!value.records.every((record) => typeof record === "string")) return undefined;
    return value as Batch;
  } catch {
    return undefined;
  }
}

function storedReader(log: ActivityLog, project: string, cache?: TranscriptCache): TranscriptReader {
  if (cache === undefined) return (_transcript, { session, part }: StoredAt) => log.transcripts.text(project, session, part);
  return (_transcript, { session, part }: StoredAt) => cache.read(log, project, session, part);
}

interface StoredOptions {
  readonly now?: Date;
  readonly home?: string;
  readonly cache?: TranscriptCache;
}

export async function storedContextReading(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, home, cache }: StoredOptions = {}): Promise<ContextReading> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) {
    await cache?.forget(project, session);
    return kept.context;
  }
  return contextReading(lines, session, {
    ...(now === undefined ? {} : { now }),
    ...(home === undefined ? {} : { home }),
    ...(cache === undefined ? { read: storedReader(log, project) } : { fold: (_transcript, harness, stored) => cache.fold(log, project, stored.session, harness, stored.part) }),
  });
}

export async function storedSessionWindow(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, cache }: StoredOptions = {}): Promise<SessionWindow> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) {
    await cache?.forget(project, session);
    return kept.window;
  }
  return sessionWindow(lines, session, { ...(now === undefined ? {} : { now }), read: storedReader(log, project, cache) });
}

export async function pruneTranscripts(log: ActivityLog, { now = new Date(), home }: { now?: Date; home?: string } = {}): Promise<number> {
  const before = new Date(now.getTime() - RETAIN_MS);
  for (const { project, session } of await log.transcripts.storedBefore(before)) {
    if ((await log.transcripts.kept(project, session)) !== undefined) continue;
    const own = await transcriptLines(log, project, session);
    const read = storedReader(log, project);
    const kept: Kept = {
      context: await contextReading(own, session, { now, ...(home === undefined ? {} : { home }), read }),
      window: await sessionWindow(own, session, { now, read }),
    };
    await log.transcripts.keep(project, session, kept);
  }
  return log.transcripts.deleteBefore(before);
}
