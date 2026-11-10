/**
 * The live reading (part of capability 3 · Arc surface, the arc surface story): while it runs it
 * asks the app's two reads about every two seconds, carrying each read's cursor forward, and re-reads
 * the clock once a minute even when nothing is new. The reads and the clock are stand-ins here, so
 * no app and no database are needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Change, Changes, ChangesFilter, Line, LineKind, LinesSince } from "@storytree/library";
import type { LinesStart } from "@storytree/session-management";
import { claimsFrom, LogFold, sessionsFrom, type LogFoldSnapshot } from "@storytree/session-management/readings";

import { liveReading, type LiveReads, type News, type Timers } from "./live-reading.js";
import { heldReading, joinedReads, pageReading, type Keeping, type KeptReading } from "./page-reading.js";

/** A stand-in clock whose timers fire only when the test moves it on. */
class Clock implements Timers {
  #now = Date.UTC(2026, 8, 27, 12);
  #timers: { ms: number; next: number; run: () => void }[] = [];

  now(): number {
    return this.#now;
  }

  every(ms: number, run: () => void): () => void {
    const timer = { ms, next: this.#now + ms, run };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((other) => other !== timer);
    };
  }

  /** Move on `ms`, firing each timer as its time comes, and let each read it starts settle. */
  async advance(ms: number): Promise<void> {
    const until = this.#now + ms;
    for (;;) {
      const due = this.#timers.filter((timer) => timer.next <= until).sort((a, b) => a.next - b.next)[0];
      if (due === undefined) break;
      this.#now = due.next;
      due.next += due.ms;
      due.run();
      await settle();
    }
    this.#now = until;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

/** The app's two reads over a project whose library and log the test adds to, recording every ask. */
class App implements LiveReads {
  readonly asked: string[] = [];
  readonly changes: Change[] = [];
  readonly lines: Line[] = [];
  failing = false;

  async changesSince(project: string, cursor: number): Promise<Changes> {
    this.asked.push(`changes ${project} ${cursor}`);
    if (this.failing) throw new Error("the app did not answer");
    const changes = this.changes.filter(({ seq }) => seq > cursor);
    return { changes, cursor: changes.at(-1)?.seq ?? cursor };
  }

  async linesSince(project: string, cursor: number): Promise<LinesSince> {
    this.asked.push(`lines ${project} ${cursor}`);
    if (this.failing) throw new Error("the app did not answer");
    const lines = this.lines.filter(({ seq }) => seq > cursor);
    return { lines, cursor: lines.at(-1)?.seq ?? cursor };
  }

  claim(capability: string): void {
    const seq = this.lines.length + 1;
    this.lines.push({ kind: "claimed", session: "s1", source: "tool", capability, reason: "building it", seq, project: "shop", at: new Date(0).toISOString() });
  }

  story(title: string): void {
    const seq = this.changes.length + 1;
    const at = new Date(0).toISOString();
    this.changes.push({ seq, recordId: `story_${seq}`, type: "story", action: "created", record: { id: `story_${seq}`, type: "story", version: 1, fields: { title }, createdAt: at, updatedAt: at } });
  }
}

function start(app: App, clock: Clock) {
  const news: News[] = [];
  const ticks: number[] = [];
  const errors: unknown[] = [];
  const reading = liveReading({
    project: "shop",
    reads: app,
    timers: clock,
    onNews: (next) => news.push(next),
    onClock: (now) => ticks.push(now),
    onError: (error) => errors.push(error),
  });
  return { reading, news, ticks, errors };
}

test("it reads everything at once, then asks about every two seconds from where it got to, and hands on only what is new", async () => {
  const app = new App();
  app.story("Visitor can sign up");
  app.claim("cap_a");
  const clock = new Clock();
  const { reading, news } = start(app, clock);
  await settle();

  assert.deepEqual(news.map(({ changes, lines }) => [changes.length, lines.length]), [[1, 1]], "the first read is everything so far");

  await clock.advance(2_000);
  assert.equal(news.length, 1, "nothing new is not news");

  app.claim("cap_b");
  await clock.advance(2_000);
  assert.deepEqual(news.at(-1)?.lines.map((line) => line.kind === "claimed" && line.capability), ["cap_b"], "a claim written while it runs arrives within two seconds");
  assert.deepEqual(app.asked.slice(-2), ["changes shop 1", "lines shop 1"], "each read carries its own cursor forward");

  reading.stop();
  const asks = app.asked.length;
  await clock.advance(10_000);
  assert.equal(app.asked.length, asks, "once stopped it asks nothing");
});

test("it re-reads the clock once a minute even when nothing is new", async () => {
  const app = new App();
  const clock = new Clock();
  const began = clock.now();
  const { reading, ticks } = start(app, clock);
  await clock.advance(59_000);
  assert.deepEqual(ticks, []);
  await clock.advance(1_000);
  assert.deepEqual(ticks, [began + 60_000]);
  await clock.advance(60_000);
  assert.deepEqual(ticks, [began + 60_000, began + 120_000]);
  reading.stop();
});

test("a read that fails is reported, and the next ask tries again from the same place", async () => {
  const app = new App();
  app.claim("cap_a");
  const clock = new Clock();
  const { reading, news, errors } = start(app, clock);
  await settle();

  app.failing = true;
  app.claim("cap_b");
  await clock.advance(2_000);
  assert.equal(errors.length, 1);
  assert.equal(news.length, 1);

  app.failing = false;
  await clock.advance(2_000);
  assert.deepEqual(news.at(-1)?.lines.map((line) => line.kind === "claimed" && line.capability), ["cap_b"]);
  reading.stop();
});

test("one page reading asks once per tick however many surfaces hear it, and each hears the same news", async () => {
  const app = new App();
  app.story("Visitor can sign up");
  app.claim("cap_a");
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const forest: News[] = [];
  const sessions: News[] = [];
  reading.subscribe({ onNews: (news) => forest.push(news) });
  reading.subscribe({ onNews: (news) => sessions.push(news) });
  await settle();
  app.claim("cap_b");
  await clock.advance(2_000);
  await clock.advance(2_000);

  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 0", "changes shop 1", "lines shop 1", "changes shop 1", "lines shop 2"], "one changes ask and one lines ask per tick");
  assert.deepEqual(forest.map(({ changes, lines }) => [changes.length, lines.length]), [[1, 1], [0, 1]]);
  assert.deepEqual(sessions, forest);
  reading.stop();
});

test("a surface that starts listening late first hears everything the page reading holds", async () => {
  const app = new App();
  app.story("Visitor can sign up");
  app.claim("cap_a");
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  reading.subscribe({ onNews: () => {} });
  await settle();
  app.claim("cap_b");
  await clock.advance(2_000);

  const board: News[] = [];
  reading.subscribe({ onNews: (news) => board.push(news) });
  await settle();
  assert.deepEqual(board.map(({ changes, lines }) => [changes.length, lines.map((line) => line.kind === "claimed" && line.capability)]), [[1, ["cap_a", "cap_b"]]]);
  const asks = app.asked.length;
  await settle();
  assert.equal(app.asked.length, asks, "joining asks the library nothing");
  reading.stop();
});

test("a surface whose handling fails hears that news again with the next, while the others hear it once", async () => {
  const app = new App();
  app.claim("cap_a");
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const steady: News[] = [];
  const shaky: News[] = [];
  const errors: unknown[] = [];
  let fail = false;
  reading.subscribe({ onNews: (news) => steady.push(news) });
  reading.subscribe({ onNews: (news) => { if (fail) throw new Error("the tree could not be read"); shaky.push(news); }, onError: (error) => errors.push(error) });
  await settle();

  fail = true;
  app.claim("cap_b");
  await clock.advance(2_000);
  assert.equal(errors.length, 1);
  fail = false;
  app.claim("cap_c");
  await clock.advance(2_000);

  const claimed = (news: News[]) => news.map(({ lines }) => lines.map((line) => line.kind === "claimed" && line.capability));
  assert.deepEqual(claimed(steady), [["cap_a"], ["cap_b"], ["cap_c"]]);
  assert.deepEqual(claimed(shaky), [["cap_a"], ["cap_b", "cap_c"]]);
  reading.stop();
});

test("the surfaces hearing one news share one read of the project's tree", async () => {
  let reads = 0;
  const tree = joinedReads({ projectTree: async (project: string) => { reads++; await settle(); return project; } });
  const [a, b] = await Promise.all([tree.projectTree("shop"), tree.projectTree("shop")]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  await tree.projectTree("shop");
  assert.equal(reads, 2, "a read asked once the last has landed reads again");
});

test("the shared tree read works over the desktop's bridge, whose functions are read-only", async () => {
  let reads = 0;
  // Electron's context bridge hands the page an object whose properties cannot be assigned.
  const bridge = Object.freeze({ projectTree: async (project: string) => { reads++; await settle(); return project; } });
  const tree = joinedReads(bridge);
  const [a, b] = await Promise.all([tree.projectTree("shop"), tree.projectTree("shop")]);
  assert.equal(a, "shop");
  assert.equal(b, "shop");
  assert.equal(reads, 1);
});

test("what the page reading holds keeps only what a surface reads: each reported health state once, and a running command's shown words", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const health = (seq: number, column: string, state: string): Change => ({ seq, recordId: "health_1", type: "health", action: "updated",
    record: { id: "health_1", type: "health", version: seq, fields: { node: "contract_1", column, state, evidence: "x".repeat(1_000) }, createdAt: at, updatedAt: at } });
  app.changes.push(health(1, "reported", "failing"), health(2, "verified", "passing"), health(3, "reported", "failing"), health(4, "reported", "passing"));
  const common = { session: "s1", source: "hook", project: "shop", at };
  const long = `node build.mjs ${"--flag ".repeat(100)}`;
  app.lines.push({ ...common, seq: 1, kind: "command-started", command: long, call: "c1" } as Line);
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();

  assert.equal(heard[0]?.changes.length, 4, "the news itself is whole");
  const held = reading.held();
  assert.deepEqual(held.changes.map(({ seq, record }) => [seq, record.fields]), [[1, { node: "contract_1", column: "reported", state: "failing" }], [4, { node: "contract_1", column: "reported", state: "passing" }]]);
  const [running] = held.fold.sessions({ now: new Date(0) })[0]?.running ?? [];
  assert.equal(running?.command.slice(0, 300), long.slice(0, 300), "a running command keeps the words the list shows");
  assert.ok((running?.command.length ?? 0) < 310);
  reading.stop();
});

test("what the page reading holds of a record keeps only the fields a surface reads: an increment without its body, an agent's role without its workflow", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const change = (seq: number, type: string, fields: Record<string, unknown>): Change => ({ seq, recordId: `${type}_1`, type, action: "updated",
    record: { id: `${type}_1`, type, version: seq, fields, createdAt: at, updatedAt: at } });
  app.changes.push(
    change(1, "increment", { title: "Time it", status: "closed", outcome: { disposition: "landed", pr: 7, note: "n".repeat(1_000) }, body: "b".repeat(1_000), pending: ["p".repeat(1_000)] }),
    change(2, "agent", { title: "session-orchestrator", role: "You drive.", workflow: "w".repeat(1_000), tools: ["t".repeat(1_000)] }),
    change(3, "decision", { title: "ADR-1", text: "We decided.", status: "accepted", links: ["capability_1"], authority: "a".repeat(1_000) }),
    change(4, "capability", { title: "Arc surface", story: "story_1", description: "Draws arcs." }),
  );
  const reading = pageReading({ project: "shop", reads: app, timers: new Clock() });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();

  assert.equal((heard[0]?.changes[0]?.record.fields as { body?: string }).body?.length, 1_000, "the news itself is whole");
  assert.deepEqual(reading.held().changes.map(({ seq, record }) => [seq, record.fields]), [
    [1, { title: "Time it", status: "closed", outcome: { disposition: "landed" } }],
    [2, { title: "session-orchestrator", role: "You drive." }],
    [3, { title: "ADR-1", text: "We decided.", status: "accepted", links: ["capability_1"] }],
    [4, { title: "Arc surface", story: "story_1", description: "Draws arcs." }],
  ]);
  reading.stop();
});

test("the page reading holds the log's sessions and claims folded, and drops every line no surface reads one by one", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const common = { session: "s1", source: "hook", project: "shop", at } as const;
  app.lines.push(
    { ...common, seq: 1, kind: "session-started" },
    { ...common, seq: 2, kind: "prompt-submitted" },
    { ...common, seq: 3, kind: "command-started", command: "pnpm gate", call: "c1" },
    { ...common, seq: 4, kind: "command-run", command: "pnpm gate", call: "c1" },
    { ...common, seq: 5, kind: "file-edited", files: ["a.ts"] },
    { ...common, seq: 6, kind: "turn-ended" },
    // The sessions list reads a subagent's start and end one by one (7.2).
    { ...common, seq: 7, kind: "subagent-started", subagent: "a1" },
    { ...common, seq: 8, kind: "subagent-ended", subagent: "a1" },
  );
  app.claim("cap_a");
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();
  app.lines.push({ ...common, seq: 10, kind: "prompt-submitted" }, { ...common, seq: 11, kind: "command-started", command: "pnpm test", call: "c2" });
  await clock.advance(2_000);

  assert.equal(heard.flatMap(({ lines }) => lines).length, 11, "every surface still hears every line");
  const held = reading.held();
  const options = { now: new Date(0) };
  assert.deepEqual(held.fold.sessions(options), sessionsFrom(app.lines, options));
  assert.deepEqual(held.fold.claims(options), claimsFrom(app.lines, options));
  assert.deepEqual(held.lines.map(({ kind }) => kind), ["subagent-started", "subagent-ended", "claimed"], "only the subagent's lines and the claim are held as lines");
  reading.stop();
});

test("3.30 · a surface's test hears what the page holds: the same thinning, so an increment and a question keep their arc and a body is gone", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const change = (seq: number, type: string, fields: Record<string, unknown>): Change => ({ seq, recordId: `${type}_1`, type, action: "updated",
    record: { id: `${type}_1`, type, version: seq, fields, createdAt: at, updatedAt: at } });
  app.changes.push(
    change(1, "increment", { title: "Time it", arc: "arc_1", status: "closed", body: "b".repeat(1_000) }),
    change(2, "question", { title: "Which?", arc: "arc_1", lifecycle: "open", context: "c".repeat(1_000) }),
  );
  const common = { session: "s1", source: "hook", project: "shop", at } as const;
  app.lines.push({ ...common, seq: 1, kind: "session-started" }, { ...common, seq: 2, kind: "file-edited", files: ["a.ts"] });
  app.claim("cap_a");
  const reading = pageReading({ project: "shop", reads: app, timers: new Clock() });
  reading.subscribe({ onNews: () => {} });
  await settle();

  const held = heldReading({ changes: app.changes, lines: app.lines });
  assert.deepEqual(held.changes, reading.held().changes, "a test's reading is thinned as the page's is");
  assert.deepEqual(held.lines, reading.held().lines, "and holds the same lines one by one");
  assert.deepEqual(held.fold.sessions({ now: new Date(0) }), reading.held().fold.sessions({ now: new Date(0) }));
  assert.deepEqual(held.changes.map(({ record }) => record.fields), [
    { title: "Time it", arc: "arc_1", status: "closed" },
    { title: "Which?", arc: "arc_1", lifecycle: "open" },
  ]);
  reading.stop();
});

/** A kept reading in memory, as the page's storage keeps one between starts: its pieces, and the latest fold written out. */
class KeptStandIn implements KeptReading {
  pieces: News[] = [];
  fold: string | undefined;
  last: Line | undefined;
  async read(): Promise<Keeping | undefined> {
    if (this.pieces.length === 0) return undefined;
    return {
      changes: this.pieces.flatMap(({ changes }) => changes),
      lines: this.pieces.flatMap(({ lines }) => lines),
      ...(this.fold === undefined ? {} : { fold: JSON.parse(this.fold) as LogFoldSnapshot }),
      ...(this.last === undefined ? {} : { last: this.last }),
    };
  }
  async add({ changes, lines, fold, last }: Keeping): Promise<void> {
    this.pieces.push({ changes, lines });
    if (fold !== undefined) this.fold = JSON.stringify(fold);
    if (last !== undefined) this.last = last;
  }
  async clear(): Promise<void> { this.pieces = []; this.fold = undefined; this.last = undefined; }
}

test("the kept reading keeps the log's fold and only the lines a surface reads one by one, and the next start reads the same sessions and claims from it", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const common = { session: "s1", source: "hook", project: "shop", at } as const;
  app.lines.push(
    { ...common, seq: 1, kind: "session-started" },
    { ...common, seq: 2, kind: "prompt-submitted" },
    { ...common, seq: 3, kind: "command-started", command: "pnpm gate", call: "c1" },
  );
  app.claim("cap_a");
  app.lines.push({ ...common, seq: 5, kind: "command-run", command: "pnpm gate", call: "c1" }, { ...common, seq: 6, kind: "file-edited", files: ["a.ts"] });
  const kept = new KeptStandIn();
  const clock = new Clock();
  const first = pageReading({ project: "shop", reads: app, timers: clock, kept });
  first.subscribe({ onNews: () => {} });
  await settle();
  app.lines.push({ ...common, seq: 7, kind: "turn-ended" });
  await clock.advance(2_000);
  first.stop();
  assert.deepEqual((await kept.read())?.lines.map(({ kind }) => kind), ["claimed"], "only the claim is kept as a line");

  app.lines.push({ ...common, seq: 8, kind: "prompt-submitted" }, { ...common, seq: 9, kind: "command-started", command: "pnpm test", call: "c2" });
  app.asked.length = 0;
  const next = pageReading({ project: "shop", reads: app, timers: clock, kept });
  next.subscribe({ onNews: () => {} });
  await settle();
  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 6"], "it still asks from just before the last line it took");
  const options = { now: new Date(0) };
  assert.deepEqual(next.held().fold.sessions(options), sessionsFrom(app.lines, options));
  assert.deepEqual(next.held().fold.claims(options), claimsFrom(app.lines, options));
  assert.deepEqual(next.held().lines.map(({ seq }) => seq), [4]);
  next.stop();
});

test("a page reading keeps what it reads, and the next start hears the kept reading at once and asks the library only from where it got to", async () => {
  const app = new App();
  app.story("Visitor can sign up");
  app.story("Visitor can pay");
  app.claim("cap_a");
  const kept = new KeptStandIn();
  const clock = new Clock();
  const first = pageReading({ project: "shop", reads: app, timers: clock, kept });
  first.subscribe({ onNews: () => {} });
  await settle();
  first.stop();
  assert.deepEqual((await kept.read())?.changes.map(({ seq }) => seq), [1, 2]);

  app.story("Visitor can leave");
  app.claim("cap_b");
  app.asked.length = 0;
  const next = pageReading({ project: "shop", reads: app, timers: clock, kept });
  const heard: News[] = [];
  next.subscribe({ onNews: (news) => heard.push(news) });
  await settle();
  assert.deepEqual(app.asked, ["changes shop 1", "lines shop 0"], "it asks from just before where it got to, to check the library still knows it");
  assert.deepEqual(heard.map(({ changes, lines }) => [changes.map(({ seq }) => seq), lines.map(({ seq }) => seq)]), [[[1, 2, 3], [1, 2]]]);
  await clock.advance(2_000);
  assert.deepEqual(app.asked.slice(-2), ["changes shop 3", "lines shop 2"]);
  assert.deepEqual((await kept.read())?.changes.map(({ seq }) => seq), [1, 2, 3], "what is new is kept too");
  next.stop();
});

test("a kept reading the library does not know is dropped, and the page reads from the start", async () => {
  const app = new App();
  app.story("Visitor can sign up");
  app.story("Visitor can pay");
  const kept = new KeptStandIn();
  const stranger = { ...app.changes[1]!, recordId: "story_elsewhere" };
  await kept.add({ changes: [app.changes[0]!, stranger], lines: [] });
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock, kept });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();
  assert.deepEqual(app.asked, ["changes shop 1", "lines shop 0", "changes shop 0", "lines shop 0"]);
  assert.deepEqual(heard.map(({ changes }) => changes.map(({ recordId }) => recordId)), [["story_1", "story_2"]]);
  assert.deepEqual((await kept.read())?.changes.map(({ recordId }) => recordId), ["story_1", "story_2"]);
  reading.stop();
});

/** The app's reads with the bounded start (Agent activity log 2.16): a stand-in that hands out the start it is given. */
class StartingApp extends App {
  given: LinesStart = { lines: [], sessions: [], claims: [], cursor: 0 };
  override async changesSince(project: string, cursor: number, filter?: ChangesFilter): Promise<Changes> {
    if (filter === undefined) return super.changesSince(project, cursor);
    this.asked.push(`changes ${project} ${cursor} only ${filter.fields?.length ?? "every"} fields, health ${filter.healthColumns?.join(",") ?? "whole"}`);
    const changes = this.changes.filter(({ seq, type, record }) => seq > cursor && (type !== "health" || filter.healthColumns?.includes(record.fields.column as string) !== false));
    return { changes, cursor: this.changes.at(-1)?.seq ?? cursor };
  }
  async linesStart(project: string, kinds: readonly LineKind[]): Promise<LinesStart> {
    this.asked.push(`start ${project} ${[...kinds].sort().join(",")}`);
    return this.given;
  }
}

test("3.29 a first start with no kept reading asks for the thinned changes and the log's bounded start, never every line from 0; it holds the sessions and claims folded from them, keeps them, and asks on from the start's cursors", async () => {
  const app = new StartingApp();
  const at = new Date(0).toISOString();
  const line = (seq: number, session: string, kind: string, more: Record<string, unknown> = {}) => ({ seq, session, source: "hook", project: "shop", at, kind, ...more }) as Line;
  app.story("Visitor signs up");
  app.changes.push({ seq: 2, recordId: "health_1", type: "health", action: "created", record: { id: "health_1", type: "health", version: 1, fields: { node: "contract_1", column: "verified", state: "passing" }, createdAt: at, updatedAt: at } });
  const claim = line(3, "s1", "claimed", { capability: "cap_a", reason: "building it" });
  const read = line(7, "s2", "note-read", { note: "principle_1", found: "id", read: "whole" });
  app.given = {
    lines: [claim, read],
    sessions: [line(1, "s1", "session-started"), claim, line(9, "s1", "prompt-submitted")],
    claims: [claim],
    cursor: 12,
  };
  const kept = new KeptStandIn();
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock, kept });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();

  assert.deepEqual(app.asked, ["changes shop 0 only 20 fields, health reported", "start shop claimed,closed,landed,merged,note-read,released,subagent-ended,subagent-started"], "never every line from 0");
  const held = reading.held();
  const options = { now: new Date(0) };
  const sessions = held.fold.sessions(options);
  assert.deepEqual(sessions.map(({ session, state }) => [session, state]), [["s1", "working"]], "the session folded from the start: prompted, in its turn");
  assert.deepEqual(held.fold.claims(options).map(({ session, capability, reason }) => [session, capability, reason]), [["s1", "cap_a", "building it"]], "and the claim standing");
  assert.deepEqual(held.lines.map(({ seq }) => seq), [3, 7], "the lines a surface reads one by one");
  assert.deepEqual(held.changes.map(({ seq }) => seq), [1], "the changes a surface reads");
  assert.deepEqual(heard.map(({ changes, lines }) => [changes.length, lines.length]), [[1, 2]], "the surfaces hear what is held");

  const keeping = await kept.read();
  assert.deepEqual(keeping?.lines.map(({ seq }) => seq), [3, 7], "the start is kept for the next");
  assert.deepEqual(LogFold.fromSnapshot(keeping!.fold!).sessions(options), sessions, "with its fold");
  assert.equal(keeping?.last?.seq, 9, "and the last line it folded");

  app.asked.length = 0;
  await clock.advance(2_000);
  assert.deepEqual(app.asked, ["changes shop 2", "lines shop 12"], "it asks on from the start's cursors");
  reading.stop();
});

test("3.29 a first start lands when its log holds a command start written with no command, as a hook wrote on 2026-09-30", async () => {
  const app = new StartingApp();
  const at = new Date(0).toISOString();
  const line = (seq: number, kind: string, more: Record<string, unknown> = {}) => ({ seq, session: "s1", source: "hook", project: "shop", at, kind, ...more }) as Line;
  app.given = { lines: [], sessions: [line(1, "session-started"), line(2, "prompt-submitted"), line(3, "command-started", { call: "c1" })], claims: [], cursor: 3 };
  const reading = pageReading({ project: "shop", reads: app, timers: new Clock() });
  const errors: unknown[] = [];
  let heard = 0;
  reading.subscribe({ onNews: () => void heard++, onError: (error) => errors.push(error) });
  await settle();

  assert.deepEqual(errors, [], "the start is not refused");
  assert.equal(heard, 1, "the surfaces hear it");
  assert.deepEqual(reading.held().fold.sessions({ now: new Date(0) }).map(({ session, state }) => [session, state]), [["s1", "working"]]);
  reading.stop();
});

test("3.29 a host without the bounded start is read whole from 0, as before", async () => {
  const app = new App();
  app.claim("cap_a");
  const reading = pageReading({ project: "shop", reads: app, timers: new Clock() });
  reading.subscribe({ onNews: () => {} });
  await settle();
  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 0"]);
  reading.stop();
});

test("3.29 a first start whose ask fails is reported and asked again at the next tick, one ask at a time, until it lands", async () => {
  const app = new StartingApp();
  const errors: unknown[] = [];
  let answer: (() => void) | undefined;
  let asks = 0;
  app.story("Visitor signs up");
  app.linesStart = async () => {
    asks++;
    if (asks === 1) throw new Error("the app did not answer");
    if (asks === 2) await new Promise<void>((resolve) => { answer = resolve; });
    return { lines: [], sessions: [], claims: [], cursor: 5 };
  };
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news), onError: (error) => errors.push(error) });
  await settle();
  assert.equal(errors.length, 1, "the failed ask is reported");
  await clock.advance(2_000);
  await clock.advance(2_000);
  assert.equal(asks, 2, "asked again at the next tick, and not again while that ask is on its way");
  answer!();
  await settle();
  assert.equal(heard.length, 1, "it lands");
  app.asked.length = 0;
  await clock.advance(2_000);
  assert.equal(asks, 2, "and is not asked again once landed");
  assert.deepEqual(app.asked, ["changes shop 1", "lines shop 5"], "the reading goes on from the start's cursors");
  reading.stop();
});

test("3.29 a reading stopped while its first start is on its way holds, keeps and tells nothing when the start lands, and asks on from nowhere", async () => {
  const app = new StartingApp();
  let answer: (() => void) | undefined;
  app.story("Visitor signs up");
  app.linesStart = async () => {
    await new Promise<void>((resolve) => { answer = resolve; });
    return { lines: [], sessions: [], claims: [], cursor: 5 };
  };
  const kept = new KeptStandIn();
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock, kept });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();
  reading.stop();
  answer!();
  await settle();
  assert.deepEqual(heard, [], "nothing is told");
  assert.equal(await kept.read(), undefined, "nothing is kept");
  assert.deepEqual(reading.held().changes, [], "nothing is held");
  app.asked.length = 0;
  await clock.advance(2_000);
  assert.deepEqual(app.asked, [], "and nothing is asked after it");
});

/** The app's reads with the bounded start and the lines that decide the sessions asked: a stand-in that hands out the log's whole lines of each. */
class ReturningApp extends StartingApp {
  earlier: Line[] = [];
  failingSessions = false;
  async sessionLines(project: string, sessions: readonly string[]): Promise<Line[]> {
    this.asked.push(`session lines ${project} ${sessions.join(",")}`);
    if (this.failingSessions) throw new Error("the app did not answer");
    return [...this.earlier, ...this.lines].filter(({ session }) => sessions.includes(session));
  }
}

test("3.31 · news from a session the bounded start left out asks the log once for the lines that decide it and folds them first, so it shows its name, first folder and start; a failed ask is reported and the news heard again at the next tick", async () => {
  const app = new ReturningApp();
  const line = (seq: number, session: string, kind: string, more: Record<string, unknown> = {}) => ({ seq, session, source: "hook", project: "shop", at: new Date(seq * 60_000).toISOString(), kind, ...more }) as Line;
  const here = line(1, "here", "session-started", { folder: "/here" });
  app.earlier = [line(2, "back", "session-started", { folder: "/back" }), line(3, "back", "session-named", { title: "Fix the rail" })];
  app.given = { lines: [], sessions: [here], claims: [], cursor: 12 };
  const clock = new Clock();
  const errors: unknown[] = [];
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  reading.subscribe({ onNews: () => {}, onError: (error) => errors.push(error) });
  await settle();

  app.lines.push(line(13, "back", "prompt-submitted", { folder: "/back/.wt/x" }), line(14, "here", "prompt-submitted"));
  app.failingSessions = true;
  app.asked.length = 0;
  await clock.advance(2_000);
  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 12", "session lines shop back"], "only the session it never folded is asked for");
  assert.equal(errors.length, 1, "a failed ask is reported");
  assert.deepEqual(reading.held().fold.sessions({ now: new Date(15 * 60_000) }).map(({ session }) => session), ["here"], "and nothing of the news is held");

  app.failingSessions = false;
  // A line the session writes after the news was read, which the log hands out with its earlier ones: it waits for its own news.
  const later = line(16, "back", "session-named", { title: "Renamed after" });
  const sessionLines = app.sessionLines.bind(app);
  app.sessionLines = async (project, sessions) => [...await sessionLines(project, sessions), later];
  app.asked.length = 0;
  await clock.advance(2_000);
  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 12", "session lines shop back"], "the news is heard again at the next tick");
  const options = { now: new Date(15 * 60_000) };
  assert.deepEqual(reading.held().fold.sessions(options), sessionsFrom([here, ...app.earlier, ...app.lines], options), "it reads as its whole history up to the news reads it");

  app.lines.push(line(15, "back", "turn-ended"));
  app.asked.length = 0;
  await clock.advance(2_000);
  assert.deepEqual(app.asked, ["changes shop 0", "lines shop 14"], "a session it has folded is not asked for again");
  reading.stop();
});
