// Capability 3 · Arc surface.
import type { Change, ChangesFilter, Line } from "@storytree/library";
import type { LinesStart } from "@storytree/session-management";
import { LogFold, type LogFoldSnapshot, type LogReading } from "@storytree/session-management/readings";

import { ASK_EVERY_MS, liveReading, pageTimers, type LiveReading, type LiveReads, type News, type Timers } from "./live-reading.js";

export interface NewsListener {
  onNews(news: News): unknown;
  onClock?(now: number): void;
  onError?(error: unknown): void;
}

export interface PageReading extends LiveReading {
  subscribe(listener: NewsListener): () => void;
  held(): News & LogReading;
}

const COMMAND_SHOWN = 300;

const READ_ONE_BY_ONE: ReadonlySet<Line["kind"]> = new Set(["claimed", "released", "landed", "closed", "merged", "subagent-started", "subagent-ended", "note-read"]);

const HELD_FIELDS = ["title", "term", "text", "statement", "meaning", "role", "description", "summary", "oneLine",
  "links", "supersedes", "frontCoverOf", "status", "state", "lifecycle", "story", "outcome", "arc"] as const;

const START_CHANGES: ChangesFilter = { fields: [...HELD_FIELDS, "node", "column"], healthColumns: ["reported"] };

function heldLine(line: Line): Line {
  if (line.kind === "command-run") return { ...line, command: "" };
  if (line.kind === "command-started" && typeof line.command !== "string") return { ...line, command: "" };
  if (line.kind === "command-started" && line.command.length > COMMAND_SHOWN) return { ...line, command: `${line.command.slice(0, COMMAND_SHOWN)} …` };
  return line;
}

function thinned(change: Change): Change {
  const from = (change.record as Change["record"] | undefined)?.fields as Record<string, unknown> | undefined;
  if (from === undefined) return change;
  const fields: Record<string, unknown> = {};
  for (const name of HELD_FIELDS) if (from[name] !== undefined) fields[name] = from[name];
  const outcome = fields.outcome as { disposition?: unknown } | undefined;
  if (outcome !== undefined) fields.outcome = typeof outcome === "object" && outcome !== null && "disposition" in outcome ? { disposition: outcome.disposition } : {};
  return { ...change, record: { ...change.record, fields } };
}

class Held implements News, LogReading {
  readonly changes: Change[] = [];
  readonly lines: Line[] = [];
  fold = new LogFold();
  last: Line | undefined;
  #reported = new Map<string, unknown>();

  restore({ changes, lines, fold, last }: Keeping): void {
    if (fold === undefined) {
      this.add({ changes, lines });
      return;
    }
    this.add({ changes, lines: [] });
    this.lines.push(...lines.filter(({ kind }) => READ_ONE_BY_ONE.has(kind)));
    this.fold = LogFold.fromSnapshot(fold);
    this.last = last ?? lines.at(-1);
  }

  begin(changes: readonly Change[], { lines, sessions, claims }: LinesStart): void {
    this.add({ changes: [...changes], lines: [] });
    this.lines.push(...lines.filter(({ kind }) => READ_ONE_BY_ONE.has(kind)));
    this.fold = LogFold.fromBounded(sessions.map(heldLine), claims);
    for (const line of [...lines, ...sessions, ...claims]) if (this.last === undefined || line.seq > this.last.seq) this.last = line;
  }

  add({ changes, lines }: News): News {
    const added: News = { changes: [], lines: [] };
    for (const change of changes) {
      if (change.type !== "health") { added.changes.push(thinned(change)); continue; }
      const { node, column, state } = change.record.fields as { node?: unknown; column?: unknown; state?: unknown };
      if (change.action === "retired" || column !== "reported" || typeof node !== "string" || this.#reported.get(node) === state) continue;
      this.#reported.set(node, state);
      added.changes.push({ ...change, record: { ...change.record, fields: { node, column, state } } });
    }
    added.lines.push(...lines.map(heldLine));
    this.changes.push(...added.changes);
    this.fold.add(added.lines);
    for (const line of added.lines) if (this.last === undefined || line.seq > this.last.seq) this.last = line;
    this.lines.push(...added.lines.filter(({ kind }) => READ_ONE_BY_ONE.has(kind)));
    return added;
  }
}

export function heldReading(news: News): News & LogReading {
  const held = new Held();
  held.add(news);
  return held;
}

export interface Keeping extends News {
  fold?: LogFoldSnapshot;
  last?: Line;
}

export interface KeptReading {
  read(): Promise<Keeping | undefined>;
  add(piece: Keeping): Promise<void>;
  clear(): Promise<void>;
}

export interface PageReadingOptions {
  project: string;
  reads: LiveReads;
  timers?: Timers;
  kept?: KeptReading;
}

interface Ears {
  listener: NewsListener;
  owed: News | undefined;
  busy: boolean;
  failedAt: number;
}

const joined = (a: News | undefined, b: News): News => a === undefined ? b : { changes: [...a.changes, ...b.changes], lines: [...a.lines, ...b.lines] };

export function pageReading({ project, reads, timers, kept }: PageReadingOptions): PageReading {
  const clock = timers ?? pageTimers;
  const everyone = new Set<Ears>();
  const held = new Held();
  let read = false;
  let stopped = false;
  let reading: LiveReading | undefined;
  let asks = 0;

  async function hand(ears: Ears): Promise<void> {
    if (ears.busy || ears.owed === undefined || stopped) return;
    const news = ears.owed;
    ears.owed = undefined;
    ears.busy = true;
    try {
      await ears.listener.onNews(news);
    } catch (error) {
      ears.owed = joined(news, ears.owed ?? { changes: [], lines: [] });
      ears.failedAt = asks;
      if (!stopped) ears.listener.onError?.(error);
    } finally {
      ears.busy = false;
    }
  }

  async function catchUp(sessionLines: NonNullable<LiveReads["sessionLines"]>, strangers: string[], lines: readonly Line[]): Promise<void> {
    const earlier = await sessionLines.call(reads, project, strangers);
    const from = Math.min(...lines.map(({ seq }) => seq));
    if (!stopped) held.fold.foldEarlier(earlier.filter(({ seq }) => seq < from).map(heldLine));
  }

  async function heard(news: News, whole: News = news): Promise<void> {
    if (read && whole.changes.length === 0 && whole.lines.length === 0) return;
    const strangers = reads.sessionLines === undefined ? [] : held.fold.strangers(news.lines);
    if (strangers.length > 0) await catchUp(reads.sessionLines!, strangers, news.lines);
    const added = held.add(news);
    read = true;
    if (kept !== undefined && (added.changes.length > 0 || added.lines.length > 0)) {
      const piece: Keeping = { changes: added.changes, lines: added.lines.filter(({ kind }) => READ_ONE_BY_ONE.has(kind)) };
      kept.add(added.lines.length === 0 ? piece : { ...piece, fold: held.fold.snapshot(), ...(held.last === undefined ? {} : { last: held.last }) })
        .catch(() => {});
    }
    await Promise.all([...everyone].map((ears) => {
      ears.owed = joined(ears.owed, whole);
      return hand(ears);
    }));
  }

  const failed = (error: unknown): void => {
    if (!stopped) for (const { listener } of everyone) listener.onError?.(error);
  };

  function live(from?: { changes: number; lines: number }): void {
    if (stopped) return;
    reading = liveReading({
      project,
      reads,
      ...(timers ? { timers } : {}),
      ...(from ? { from } : {}),
      onNews: (news) => heard(news),
      onAsked() {
        asks++;
        for (const ears of everyone) if (ears.failedAt < asks - 1) void hand(ears);
      },
      onClock(now) {
        for (const { listener } of everyone) listener.onClock?.(now);
      },
      onError: failed,
    });
  }

  async function resume(): Promise<void> {
    const last = await kept!.read().catch(() => undefined);
    if (stopped) return;
    if (last === undefined || (last.changes.length === 0 && last.lines.length === 0 && last.last === undefined)) return begin();
    const change = last.changes.at(-1);
    const line = last.last ?? last.lines.at(-1);
    const from = { changes: Math.max(0, (change?.seq ?? 0) - 1), lines: Math.max(0, (line?.seq ?? 0) - 1) };
    let unheard: Keeping | undefined = last;
    let trying = false;
    const attempt = async (): Promise<boolean> => {
      if (trying || stopped) return stopped;
      trying = true;
      try {
        const [changes, lines] = await Promise.all([reads.changesSince(project, from.changes), reads.linesSince(project, from.lines)]);
        if (stopped) return true;
        const knows = (change === undefined || (changes.changes[0]?.seq === change.seq && changes.changes[0].recordId === change.recordId))
          && (line === undefined || (lines.lines[0]?.seq === line.seq && lines.lines[0].session === line.session && lines.lines[0].kind === line.kind));
        if (!knows) {
          unheard = undefined;
          await kept!.clear().catch(() => {});
          void begin();
          return true;
        }
        if (unheard !== undefined) held.restore(unheard);
        unheard = undefined;
        const news = { changes: changes.changes.filter(({ seq }) => seq > (change?.seq ?? 0)), lines: lines.lines.filter(({ seq }) => seq > (line?.seq ?? 0)) };
        await heard(news, { changes: [...held.changes, ...news.changes], lines: [...held.lines, ...news.lines] });
        live({ changes: changes.cursor, lines: lines.cursor });
        return true;
      } catch (error) {
        failed(error);
        return false;
      } finally {
        trying = false;
      }
    };
    if (await attempt()) return;
    const stopTrying = clock.every(ASK_EVERY_MS, () => void attempt().then((done) => { if (done) stopTrying(); }));
  }

  async function begin(): Promise<void> {
    const linesStart = reads.linesStart;
    if (linesStart === undefined) return live();
    let trying = false;
    const attempt = async (): Promise<boolean> => {
      if (trying || stopped) return stopped;
      trying = true;
      try {
        const [changes, start] = await Promise.all([reads.changesSince(project, 0, START_CHANGES), linesStart.call(reads, project, [...READ_ONE_BY_ONE])]);
        if (stopped) return true;
        held.begin(changes.changes, start);
        kept?.add({ changes: [...held.changes], lines: [...held.lines], fold: held.fold.snapshot(), ...(held.last === undefined ? {} : { last: held.last }) })
          .catch(() => {});
        await heard({ changes: [], lines: [] }, { changes: [...held.changes], lines: [...held.lines] });
        live({ changes: changes.cursor, lines: start.cursor });
        return true;
      } catch (error) {
        failed(error);
        return false;
      } finally {
        trying = false;
      }
    };
    if (await attempt()) return;
    const stopTrying = clock.every(ASK_EVERY_MS, () => void attempt().then((done) => { if (done) stopTrying(); }));
  }

  if (kept === undefined) void begin();
  else void resume();

  return {
    subscribe(listener) {
      const ears: Ears = { listener, owed: read ? { changes: [...held.changes], lines: [...held.lines] } : undefined, busy: false, failedAt: -Infinity };
      everyone.add(ears);
      void hand(ears);
      return () => { everyone.delete(ears); };
    },
    held: () => held,
    stop() {
      stopped = true;
      everyone.clear();
      reading?.stop();
    },
  };
}

export function joinedReads<T extends { projectTree(project: string): Promise<unknown> }>(reads: T): T {
  const going = new Map<string, Promise<unknown>>();
  const projectTree = (project: string): Promise<unknown> => {
    let read = going.get(project);
    if (read === undefined) {
      read = reads.projectTree(project).finally(() => going.delete(project));
      going.set(project, read);
    }
    return read;
  };
  return Object.defineProperty(Object.create(reads) as T, "projectTree", { value: projectTree, enumerable: true });
}
