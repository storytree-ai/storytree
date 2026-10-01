/**
 * The live reading (part of capability 3 · Arc surface, the arc surface story): while it runs it
 * asks the app's two reads about every two seconds, carrying each read's cursor forward, and re-reads
 * the clock once a minute even when nothing is new. The reads and the clock are stand-ins here, so
 * no app and no database are needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, LinesSince } from "@storytree/agent-link";
import type { Change, Changes } from "@storytree/library";

import { liveReading, type LiveReads, type News, type Timers } from "./live-reading.js";
import { joinedReads, pageReading, type KeptReading } from "./page-reading.js";

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

test("what the page reading holds keeps only what a surface reads: each reported health state once, and a command's shown words", async () => {
  const app = new App();
  const at = new Date(0).toISOString();
  const health = (seq: number, column: string, state: string): Change => ({ seq, recordId: "health_1", type: "health", action: "updated",
    record: { id: "health_1", type: "health", version: seq, fields: { node: "contract_1", column, state, evidence: "x".repeat(1_000) }, createdAt: at, updatedAt: at } });
  app.changes.push(health(1, "reported", "failing"), health(2, "verified", "passing"), health(3, "reported", "failing"), health(4, "reported", "passing"));
  const common = { session: "s1", project: "shop", at };
  const long = `node build.mjs ${"--flag ".repeat(100)}`;
  app.lines.push({ ...common, seq: 1, kind: "command-started", command: long, call: "c1" } as Line, { ...common, seq: 2, kind: "command-run", command: long, call: "c1" } as Line);
  const clock = new Clock();
  const reading = pageReading({ project: "shop", reads: app, timers: clock });
  const heard: News[] = [];
  reading.subscribe({ onNews: (news) => heard.push(news) });
  await settle();

  assert.equal(heard[0]?.changes.length, 4, "the news itself is whole");
  const held = reading.held();
  assert.deepEqual(held.changes.map(({ seq, record }) => [seq, record.fields]), [[1, { node: "contract_1", column: "reported", state: "failing" }], [4, { node: "contract_1", column: "reported", state: "passing" }]]);
  const [started, ran] = held.lines as (Line & { command: string })[];
  assert.equal(started?.command.slice(0, 300), long.slice(0, 300), "a running command keeps the words the list shows");
  assert.ok((started?.command.length ?? 0) < 310);
  assert.equal(ran?.command, "", "a finished command's text is not shown anywhere");
  reading.stop();
});

/** A kept reading in memory, as the page's storage keeps one between starts. */
class KeptStandIn implements KeptReading {
  pieces: News[] = [];
  async read(): Promise<News | undefined> {
    return this.pieces.length === 0 ? undefined : { changes: this.pieces.flatMap(({ changes }) => changes), lines: this.pieces.flatMap(({ lines }) => lines) };
  }
  async add(news: News): Promise<void> { this.pieces.push(news); }
  async clear(): Promise<void> { this.pieces = []; }
}

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
