/**
 * Capability 9 · Context readings. Readings parsed from the shared log (ADR-0749 D3, D4): a session's context reading and window,
 * worked out by our own folds from the transcript records its hooks streamed in, so an app on any
 * machine reads every machine's sessions without opening a transcript file. Raw records expire
 * after RETAIN_MS; before they go, what was worked out from them is kept, and read from then on.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ActivityLog, Line } from "../activity/index.js";
import { contextReading, transcriptLines, type ContextReading, type TranscriptReader } from "../context/context.js";
import { sessionWindow, type SessionWindow } from "../context/window.js";

/** How long raw transcript records are kept: 180 days (D4). */
export const RETAIN_MS = 180 * 24 * 60 * 60 * 1000;

/** What is kept of a session once its raw records expire. */
interface Kept {
  readonly context: ContextReading;
  readonly window: SessionWindow;
}

/** What a cache has of one session's stored transcript: its records so far, and the byte past the last. */
interface Held {
  readonly records: readonly string[];
  readonly finish: number;
}

/** One fetch, as a checkpoint file keeps it: a line of its own, so a torn or doubled write costs only itself. */
interface Batch {
  readonly from: number;
  readonly finish: number;
  readonly records: readonly string[];
}

const NOTHING: Held = { records: [], finish: 0 };

/**
 * What a reader that asks again and again (the app, every 10 seconds) already has of each session's
 * stored transcript, so each ask fetches only the records stored since. Given a folder, it also keeps
 * them there, so a restarted app fetches only what was stored while it was closed (app 3.10). The
 * folder is one store's and one project's: the caller names it so no other's can be read for it.
 * Records are kept whole, not the readings worked out from them, so every fold reads exactly what it
 * would read from the store. Asks for one session wait on each other rather than fetching twice.
 */
export class TranscriptCache {
  readonly #dir: string | undefined;
  readonly #held = new Map<string, Promise<Held>>();

  constructor(dir?: string) {
    this.#dir = dir;
  }

  /** `session`'s own transcript as stored in `project`'s log: what is held, and what was stored since. */
  async read(log: ActivityLog, project: string, session: string): Promise<string | undefined> {
    const key = `${project}\0${session}`;
    const before = this.#held.get(key) ?? this.#load(log, project, session);
    const after = before.then((had) => this.#add(log, project, session, had));
    this.#held.set(key, after.catch(() => before));
    const now = await after;
    return now.records.length === 0 ? undefined : now.records.join("\n");
  }

  /** Let `session` go, here and on disk: its raw records expired, and what was kept of them is read instead. */
  async forget(project: string, session: string): Promise<void> {
    this.#held.delete(`${project}\0${session}`);
    const file = this.#file(project, session);
    if (file !== undefined) await rm(file, { force: true }).catch(() => {});
  }

  #file(project: string, session: string): string | undefined {
    if (this.#dir === undefined) return undefined;
    return path.join(this.#dir, `${createHash("sha256").update(`${project}\0${session}`).digest("hex").slice(0, 32)}.jsonl`);
  }

  /**
   * What the folder kept of `session`, never failing: a missing or unreadable file, or a line that
   * does not continue from the one before, is left out, and the file is written again without it.
   * A store holding less than was kept (emptied, or not the one it came from) leaves nothing kept.
   */
  async #load(log: ActivityLog, project: string, session: string): Promise<Held> {
    const file = this.#file(project, session);
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
    if (finish > 0 && ((await log.transcripts.cursors(project, session)).get("") ?? 0) < finish) {
      await rm(file, { force: true }).catch(() => {});
      return NOTHING;
    }
    const held = { records, finish };
    if (dropped) await this.#write(file, held, "rewrite");
    return held;
  }

  async #add(log: ActivityLog, project: string, session: string, had: Held): Promise<Held> {
    const added = await log.transcripts.since(project, session, had.finish);
    if (added.records.length === 0) return had;
    const now = { records: [...had.records, ...added.records], finish: added.finish };
    const file = this.#file(project, session);
    if (file !== undefined) await this.#write(file, { from: had.finish, ...added }, "append");
    return now;
  }

  /** Append one batch, or write `held` afresh through a file put in place whole. A failure only costs a later fetch. */
  async #write(file: string, batch: Batch | Held, how: "append" | "rewrite"): Promise<void> {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      if (how === "append") {
        await appendFile(file, `${JSON.stringify(batch)}\n`);
      } else {
        const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
        await writeFile(temporary, batch.records.length === 0 ? "" : `${JSON.stringify({ from: 0, finish: batch.finish, records: batch.records })}\n`);
        await rename(temporary, file);
      }
    } catch {
      // The checkpoint only saves fetches: a folder that cannot be written is read from the store.
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

/** A reader of `session`'s own transcript as stored in `project`'s log, through `cache` when given. */
function storedReader(log: ActivityLog, project: string, session: string, cache?: TranscriptCache): TranscriptReader {
  if (cache === undefined) return () => log.transcripts.text(project, session);
  return () => cache.read(log, project, session);
}

interface StoredOptions {
  readonly now?: Date;
  readonly home?: string;
  readonly cache?: TranscriptCache;
}

/** `session`'s context reading, parsed from its stored records; what was kept, once they expired. */
export async function storedContextReading(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, home, cache }: StoredOptions = {}): Promise<ContextReading> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) {
    await cache?.forget(project, session);
    return kept.context;
  }
  return contextReading(lines, session, { ...(now === undefined ? {} : { now }), ...(home === undefined ? {} : { home }), read: storedReader(log, project, session, cache) });
}

/** `session`'s window, parsed from its stored records; what was kept, once they expired. */
export async function storedSessionWindow(log: ActivityLog, project: string, lines: readonly Line[], session: string,
  { now, cache }: StoredOptions = {}): Promise<SessionWindow> {
  const kept = (await log.transcripts.kept(project, session)) as Kept | undefined;
  if (kept !== undefined) {
    await cache?.forget(project, session);
    return kept.window;
  }
  return sessionWindow(lines, session, { ...(now === undefined ? {} : { now }), read: storedReader(log, project, session, cache) });
}

/**
 * The retention pass: for each session with a record stored more than RETAIN_MS before `now`, keep
 * its readings worked out from all it has stored, then delete every record past the limit.
 * Returns how many records went.
 */
export async function pruneTranscripts(log: ActivityLog, { now = new Date(), home }: { now?: Date; home?: string } = {}): Promise<number> {
  const before = new Date(now.getTime() - RETAIN_MS);
  for (const { project, session } of await log.transcripts.storedBefore(before)) {
    if ((await log.transcripts.kept(project, session)) !== undefined) continue;
    const own = await transcriptLines(log, project, session);
    const read = storedReader(log, project, session);
    const kept: Kept = {
      context: await contextReading(own, session, { now, ...(home === undefined ? {} : { home }), read }),
      window: await sessionWindow(own, session, { now, read }),
    };
    await log.transcripts.keep(project, session, kept);
  }
  return log.transcripts.deleteBefore(before);
}
