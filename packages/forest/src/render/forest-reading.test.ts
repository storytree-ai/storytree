/**
 * The forest's reading: the live reading's news, with the project's tree read again when the library
 * changed. A first read that fails, as a slow or cloud library's connection timeout can, is retried
 * until it lands, so the forest is drawn once the library answers. The reads and timers are stand-ins.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { joinedReads, pageReading, type News, type Timers } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

import { forestReading, treeAfter, type ForestReads } from "./forest-reading.js";

const tree: AnnotatedTree = { arcs: [], stories: [] } as unknown as AnnotatedTree;

/** Timers that fire only when the test ticks them. */
function handTimers(): Timers & { tick(): Promise<void> } {
  const runs: (() => void)[] = [];
  return {
    now: () => 0,
    every(ms, run) {
      if (ms === 2_000) runs.push(run);
      return () => runs.splice(runs.indexOf(run), 1);
    },
    async tick() {
      for (const run of runs) run();
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

test("a first read of the tree that fails is retried, and the forest is drawn once the library answers", async () => {
  let failing = true;
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => {
      if (failing) throw new Error("Connection terminated due to connection timeout");
      return tree;
    },
  };
  const timers = handTimers();
  const drawn: AnnotatedTree[] = [];
  const errors: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (read) => drawn.push(read), onError: (error) => errors.push(error) });
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(drawn.length, 0);

  failing = false;
  await timers.tick();
  assert.deepEqual(drawn, [tree]);
  reading.stop();
});

/** Timers whose clock the test sets, firing every 2-second ask when ticked. */
function clockTimers(): Timers & { at: number; tick(): Promise<void> } {
  const runs: (() => void)[] = [];
  return {
    at: 0,
    now() { return this.at; },
    every(ms, run) {
      if (ms === 2_000) runs.push(run);
      return () => runs.splice(runs.indexOf(run), 1);
    },
    async tick() {
      for (const run of [...runs]) run();
      await settle();
    },
  };
}

const survey = { "story-shop": { files: [{ path: "src/claim.ts", lines: 1 }], imports: [] } };

const merged = {
  seq: 1, project: "shop", at: "2026-10-06T00:00:00Z", session: "observer", source: "tool",
  kind: "merged", increment: "increment_1", holder: "builder", branch: "work", pr: 1,
} satisfies News["lines"][number];
const closed = {
  seq: 2, project: "shop", at: merged.at, session: "builder", source: "tool",
  kind: "closed", increment: "increment_1", disposition: "landed",
} satisfies News["lines"][number];
const increment: News["changes"][number] = {
  seq: 1, recordId: "increment_1", type: "increment", action: "updated",
  record: {
    id: "increment_1", type: "increment", version: 2, createdAt: merged.at, updatedAt: merged.at,
    fields: { arc: "arc_1", title: "New code", objective: "New code", body: "New code", status: "closed", outcome: { date: "2026-10-06", disposition: "landed", pr: "1" } },
  },
};

test("7.25 landing news refreshes the survey from the existing tree, coalesces within ten seconds and ignores unrelated traffic", async (t) => {
  let news: News = { changes: [], lines: [] };
  let trees = 0;
  let surveys = 0;
  let current = survey;
  const reads: ForestReads = {
    changesSince: async (_project, cursor) => ({ changes: news.changes.splice(0), cursor: cursor + 1 }),
    linesSince: async (_project, cursor) => ({ lines: news.lines.splice(0), cursor: cursor + 1 }),
    projectTree: async () => (trees++, tree),
    codeSurvey: async () => (surveys++, current),
  };
  const timers = clockTimers();
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (read, _news, code) => {
    assert.equal(read, tree);
    drawn.push(code);
  }, onError: (error) => { throw error; } });
  t.after(() => reading.stop());
  await settle();
  assert.deepEqual({ trees, surveys }, { trees: 1, surveys: 1 });

  // Each landing signal works alone, without a plan change or a restart.
  for (const landing of [{ changes: [], lines: [merged] }, { changes: [], lines: [closed] }, { changes: [increment], lines: [] }]) {
    current = { "story-shop": { files: [{ path: "src/claim.ts", lines: surveys + 1 }], imports: [] } };
    news = landing;
    timers.at += 12_000;
    const before = surveys;
    await timers.tick();
    assert.equal(surveys, before + 1);
    assert.deepEqual(drawn.at(-1), current, "newly landed code is drawn");
    assert.equal(trees, 1, "landing news preserves 7.24");
  }

  const before = surveys;
  for (let repeat = 0; repeat < 4; repeat++) {
    news = { changes: [], lines: [{ ...merged, seq: 10 + repeat }] };
    timers.at += 2_000;
    await timers.tick();
    assert.equal(surveys, before);
  }
  const draws = drawn.length;
  timers.at += 2_000;
  await timers.tick();
  assert.equal(surveys, before + 1, "repeated landing news coalesces into one paced survey");
  assert.equal(drawn.length, draws, "an unchanged survey adds no redraw");

  news = {
    lines: [
      { ...closed, disposition: "failed" }, { ...closed, disposition: "withdrawn" },
      { seq: 20, project: "shop", at: merged.at, session: "builder", source: "hook", kind: "file-edited", files: ["src/claim.ts"] },
      { seq: 21, project: "shop", at: merged.at, session: "builder", source: "tool", kind: "landed", capability: "capability_1" },
    ],
    changes: [
      { ...increment, record: { ...increment.record, fields: { status: "active" } } },
      { ...increment, record: { ...increment.record, fields: { status: "closed", outcome: { disposition: "failed" } } } },
      { ...increment, record: { ...increment.record, fields: { status: "closed", outcome: { disposition: "withdrawn" } } } },
      { ...increment, action: "retired" },
    ],
  };
  timers.at += 12_000;
  await timers.tick();
  timers.at += 12_000;
  await timers.tick();
  assert.deepEqual({ trees, surveys }, { trees: 1, surveys: before + 1 });
});

test("7.25 landing news during a survey converges one read at a time, retries failures and stops pending redraws", async (t) => {
  let lines: News["lines"] = [];
  let trees = 0;
  let surveys = 0;
  let land!: (value: typeof survey) => void;
  let fail!: (error: Error) => void;
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async (_project, cursor) => ({ lines: lines.splice(0), cursor: cursor + 1 }),
    projectTree: async () => (trees++, tree),
    codeSurvey: () => {
      surveys++;
      return new Promise((resolve, reject) => { land = resolve; fail = reject; });
    },
  };
  const timers = clockTimers();
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (_tree, _news, code) => drawn.push(code), onError: (error) => { throw error; } });
  t.after(() => reading.stop());
  await settle();
  assert.deepEqual(drawn, [{}], "the tree never waits for a survey");
  for (const at of [12_000, 14_000]) {
    lines = [{ ...merged, seq: at }];
    timers.at = at;
    await timers.tick();
    assert.equal(surveys, 1, "a running survey is never overlapped");
  }
  land(survey);
  await settle();
  timers.at = 16_000;
  await timers.tick();
  assert.equal(surveys, 2, "news during a survey is remembered");
  fail(new Error("temporarily offline"));
  await settle();
  timers.at = 24_000;
  await timers.tick();
  assert.equal(surveys, 2, "a retry is paced too");
  timers.at = 26_000;
  await timers.tick();
  assert.equal(surveys, 3, "a failed survey retries without more news");
  const newer = { "story-shop": { files: [{ path: "src/new.ts", lines: 10 }], imports: [] } };
  land(newer);
  await settle();
  assert.deepEqual(drawn.at(-1), newer);
  assert.equal(trees, 1);

  lines = [{ ...merged, seq: 30 }];
  timers.at = 36_000;
  await timers.tick();
  assert.equal(surveys, 4);
  lines = [{ ...merged, seq: 31 }];
  timers.at = 38_000;
  await timers.tick();
  reading.stop();
  const draws = drawn.length;
  land(survey);
  await settle();
  timers.at = 50_000;
  await timers.tick();
  assert.equal(drawn.length, draws, "a stopped reading never draws the pending survey");
  assert.equal(surveys, 4, "a stopped reading never services a queued refresh");
});

test("7.25 stopping during a tree read prevents a later survey and draw", async () => {
  let finish!: (value: AnnotatedTree) => void;
  let surveys = 0;
  let draws = 0;
  const timers = clockTimers();
  const reading = forestReading({ project: "shop", timers, reads: {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: () => new Promise((resolve) => { finish = resolve; }),
    codeSurvey: async () => (surveys++, survey),
  }, onTree: () => { draws++; }, onError: (error) => { throw error; } });
  await settle();
  reading.stop();
  finish(tree);
  await settle();
  timers.at = 12_000;
  await timers.tick();
  assert.deepEqual({ surveys, draws }, { surveys: 0, draws: 0 });
});

test("the tree is drawn without waiting for the code's survey, and drawn again with the survey once it lands", async () => {
  let land: (value: typeof survey) => void = () => {};
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [], cursor: 0 }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => tree,
    codeSurvey: () => new Promise((resolve) => { land = resolve; }),
  };
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers: clockTimers(), onTree: (_read, _news, read) => drawn.push(read), onError: () => {} });
  await settle();
  assert.deepEqual(drawn, [{}]);

  land(survey);
  await settle();
  assert.deepEqual(drawn, [{}, survey]);
  reading.stop();
});

test("the code is surveyed again at most every 10 seconds however often the tree changes, and a change in between is surveyed once they pass", async () => {
  let cursor = 0;
  let surveys = 0;
  const reads: ForestReads = {
    changesSince: async () => ({ changes: [{ seq: ++cursor, type: "capability" } as never], cursor }),
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => tree,
    codeSurvey: async () => (surveys++, survey),
  };
  const timers = clockTimers();
  const drawn: unknown[] = [];
  const reading = forestReading({ project: "shop", reads, timers, onTree: (_read, _news, read) => drawn.push(read), onError: () => {} });
  await settle();
  assert.equal(surveys, 1);

  for (let second = 2; second < 10; second += 2) {
    timers.at = second * 1_000;
    await timers.tick();
  }
  assert.equal(surveys, 1);

  timers.at = 10_000;
  await timers.tick();
  assert.equal(surveys, 2);
  assert.deepEqual(drawn.at(-1), survey);
  reading.stop();
});

test("the forest draws from the page's one reading, and the surfaces hearing it share one read of the tree", async () => {
  const asked: string[] = [];
  const reads: ForestReads = {
    changesSince: async (_project, cursor) => (asked.push(`changes ${cursor}`), { changes: [], cursor }),
    linesSince: async (_project, cursor) => (asked.push(`lines ${cursor}`), { lines: [], cursor }),
    projectTree: async () => (asked.push("tree"), await settle(), tree),
  };
  const shared = joinedReads(reads);
  const timers = handTimers();
  const page = pageReading({ project: "shop", reads: shared, timers });
  const drawn: AnnotatedTree[] = [];
  const reading = forestReading({ project: "shop", reads: shared, reading: page, timers, onTree: (read) => drawn.push(read), onError: () => {} });
  page.subscribe({ onNews: () => shared.projectTree("shop") });
  await settle();
  await settle();
  await timers.tick();
  assert.deepEqual(drawn, [tree]);
  assert.deepEqual(asked, ["changes 0", "lines 0", "tree", "changes 0", "lines 0"]);
  reading.stop();
  page.stop();
});

test("7.27 a health change re-recording the state the tree already shows draws from the tree held; a changed state, an unknown contract or another tree change reads it again", async () => {
  let asked = 0;
  const counted = { projectTree: async () => { asked++; return tree; } };
  const column = (state: string) => ({ state, by: "storytree", at: "2026-10-08T00:00:00Z" });
  const held = { arcs: [], stories: [{ id: "story_1", capabilities: [{ id: "capability_1", contracts: [
    { id: "contract_1", health: { reported: column("passing"), verified: column("failing") } },
  ] }] }] } as unknown as AnnotatedTree;
  const health = (node: string, column: string, state: string) => ({ type: "health", action: "updated" as const, record: { fields: { node, column, state } } as never });
  const news = (...changes: { type: string; action: "updated"; record: never }[]) => ({ lines: [], changes: changes.map((change, n) => ({ seq: n + 1, recordId: `r${n}`, ...change })) });

  assert.equal(await treeAfter(counted, "shop", news(health("contract_1", "reported", "passing"), health("contract_1", "verified", "failing")), held), held);
  assert.equal(asked, 0, "health re-recorded unchanged leaves the tree as it was");
  await treeAfter(counted, "shop", news(health("contract_1", "verified", "passing")), held);
  assert.equal(asked, 1, "a state that changed reads the tree");
  await treeAfter(counted, "shop", news(health("contract_9", "reported", "passing")), held);
  assert.equal(asked, 2, "a contract the tree does not hold reads the tree");
  await treeAfter(counted, "shop", news(health("contract_1", "reported", "passing"), { type: "capability", action: "updated", record: { fields: {} } as never }), held);
  assert.equal(asked, 3, "another change to the tree's records still reads it");
});

test("7.24 the sessions list and the forest re-read the plan only when their news holds a change to a story, capability, contract, arc or health record; other news draws from the tree they have, and their first news always reads", async () => {
  let asked = 0;
  const counted = { projectTree: async () => { asked++; return tree; } };
  // A health change as the page passes one on: a contract's reported state moving.
  const fieldsOf = (type: string) => (type === "health" ? { node: "contract_1", column: "reported", state: "passing" } : {});
  const news = (...types: string[]) => ({ lines: [], changes: types.map((type, n) => ({ seq: n + 1, recordId: `${type}_1`, type, action: "updated" as const, record: { fields: fieldsOf(type) } as never })) });
  // The rule both surfaces read the tree by.
  assert.equal(await treeAfter(counted, "shop", news(), undefined), tree);
  assert.equal(asked, 1, "the first news reads the tree");
  assert.equal(await treeAfter(counted, "shop", news("decision", "friction", "increment", "question"), tree), tree);
  assert.equal(asked, 1, "notes and work leave the tree as it was");
  for (const type of ["story", "capability", "contract", "arc", "health"]) await treeAfter(counted, "shop", news(type), tree);
  assert.equal(asked, 6, "each change to the tree's own records reads it again");

  // The forest hears its news so: a decision's change draws the tree it has, a health change reads it.
  const asks = [[], ["decision"], ["health"]];
  let ask = -1;
  let reads = 0;
  const forestReads: ForestReads = {
    changesSince: async () => { ask++; return { changes: news(...(asks[ask] ?? [])).changes, cursor: ask + 1 }; },
    linesSince: async () => ({ lines: [], cursor: 0 }),
    projectTree: async () => { reads++; return tree; },
  };
  const timers = handTimers();
  let drawn = 0;
  const reading = forestReading({ project: "shop", reads: forestReads, timers, onTree: () => { drawn++; }, onError: (error) => { throw error; } });
  // Each ask is let finish before the next, as two seconds between them would.
  const answered = async (tick?: () => Promise<void>) => { await tick?.(); await new Promise((resolve) => setImmediate(resolve)); };
  await answered();
  assert.deepEqual({ reads, drawn }, { reads: 1, drawn: 1 });
  await answered(() => timers.tick());
  assert.deepEqual({ reads, drawn }, { reads: 1, drawn: 2 }, "a decision's change is drawn from the tree the forest has");
  await answered(() => timers.tick());
  assert.deepEqual({ reads, drawn }, { reads: 2, drawn: 3 }, "a health change reads the tree again");
  reading.stop();
});
