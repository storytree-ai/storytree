// Capability 4 · Measures over time per story
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";

import * as codeMeasures from "./index.js";

type Reads = "not shown" | "shifted up" | "shifted down" | "too few readings";

interface Limits {
  readonly centre: number;
  readonly lower: number;
  readonly upper: number;
}

interface Xmr {
  readonly latest: number;
  readonly limits?: Limits;
  readonly reads: Reads;
}

interface ReadingRow {
  readonly project: string;
  readonly story: string;
  readonly measure: string;
  readonly version: number;
  readonly value: number;
  readonly unit: string;
  readonly commit: string;
  readonly committed: string;
  readonly machine: string;
  readonly runs: number;
  readonly spread: number | null;
  readonly readAt: string;
}

interface SeriesReading {
  readonly commit: string;
  readonly committed: string;
  readonly value: number;
  readonly runs: number;
  readonly spread: number | null;
}

interface MeasureSeries {
  readonly story: string;
  readonly measure: string;
  readonly version: number;
  readonly machine: string;
  readonly unit: string;
  readonly readings: readonly SeriesReading[];
}

interface ReadingsDb {
  query(text: string, values?: unknown[]): Promise<{ rows: object[] }>;
}

interface OverTimeSeam {
  xmr(values: readonly number[]): Xmr;
  measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<ReadingsDb>;
  writeReadings(db: ReadingsDb, rows: readonly ReadingRow[]): Promise<void>;
  seriesIn(db: ReadingsDb, of: { project: string; from: string; to: string }): Promise<MeasureSeries[]>;
}

const seam = codeMeasures as unknown as OverTimeSeam;
const READS: readonly Reads[] = ["not shown", "shifted up", "shifted down", "too few readings"];

function near(actual: Limits | undefined, expected: Limits, why: string): void {
  assert.ok(actual !== undefined, `${why}: limits given`);
  for (const side of ["centre", "lower", "upper"] as const) {
    assert.ok(Math.abs(actual[side] - expected[side]) < 1e-9, `${why}: ${side} is ${expected[side]}, got ${actual[side]}`);
  }
}

function read(values: readonly number[]): Xmr {
  assert.equal(typeof seam.xmr, "function", "code measures exports xmr");
  const answer = seam.xmr(values);
  assert.ok(READS.includes(answer.reads), `a reading is one of ${READS.join(", ")}, never a win or a loss: got ${String(answer.reads)}`);
  assert.equal(answer.latest, values[values.length - 1], "the latest is the last value");
  return answer;
}

test("4.1 · xmr gives limits of the mean of the readings before the latest plus or minus 2.66 times their average moving range; the latest inside reads not shown, above shifted up, below shifted down; fewer than five earlier readings give no limits and read too few readings", () => {
  const lines = [12_040, 12_110, 12_075, 12_180, 12_150];
  const linesLimits = { centre: 12_111, lower: 11_951.4, upper: 12_270.6 };
  const down = read([...lines, 11_950]);
  near(down.limits, linesLimits, "source lines");
  assert.equal(down.reads, "shifted down", "below the lower limit");
  assert.equal(read([...lines, 11_951.5]).reads, "not shown", "just inside the lower limit");
  assert.equal(read([...lines, 12_270.5]).reads, "not shown", "just inside the upper limit");
  assert.equal(read([...lines, 12_270.7]).reads, "shifted up", "just above the upper limit");

  const small = [10, 12, 11, 13, 12];
  const smallLimits = { centre: 11.6, lower: 7.61, upper: 15.59 };
  const up = read([...small, 15.6]);
  near(up.limits, smallLimits, "the latest is left out of its own limits");
  assert.equal(up.reads, "shifted up");
  assert.equal(read([...small, 15.58]).reads, "not shown");
  assert.equal(read([...small, 7.6]).reads, "shifted down");
  assert.equal(read([...small, 7.62]).reads, "not shown");

  const swinging = read([3, 9, 4, 8, 5, 7, 6, 15.4]);
  near(swinging.limits, { centre: 6, lower: -3.31, upper: 15.31 }, "every earlier reading counts, and each moving range is a distance");
  assert.equal(swinging.reads, "shifted up");

  const four = read(small);
  assert.equal(four.limits, undefined, "four earlier readings give no limits");
  assert.equal(four.reads, "too few readings");
  const one = read([7]);
  assert.equal(one.limits, undefined, "one reading gives no limits");
  assert.equal(one.reads, "too few readings");
});

async function server(): Promise<Storytree> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  return connect({ url });
}

const ALPHA = "story_a1a1a1a1a1a1";
const BETA = "story_b2b2b2b2b2b2";
const LINES = "measure_400000000001";
const TIMING = "measure_400000000002";
const commit = (n: number) => `c${n}`.padEnd(40, "0");

test("4.2 · seriesIn groups a project's readings committed in the window, its first and last days included by UTC day, into one series per story, measure, version and machine, each ordered by committed, each reading carrying its runs and spread", async (t) => {
  const storytree = await server();
  const project = `t-${randomBytes(4).toString("hex")}`;
  let db: ReadingsDb | undefined;
  t.after(async () => {
    try {
      await db?.query("DELETE FROM measure_readings WHERE project = $1 OR project = $2", [project, `${project}-other`]);
    } finally {
      await storytree.close();
    }
  });
  assert.equal(typeof seam.seriesIn, "function", "code measures exports seriesIn");
  db = await seam.measureReadingsPool(storytree);
  const row = (fields: Partial<ReadingRow> & Pick<ReadingRow, "commit" | "committed" | "value">): ReadingRow => ({
    project, story: ALPHA, measure: LINES, version: 1, unit: "lines", machine: "mint", runs: 1, spread: null, readAt: "2026-11-18T06:00:00.000Z", ...fields,
  });
  const first = row({ commit: commit(1), committed: "2026-11-01T00:00:00.000Z", value: 12_040 });
  const middle = row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 12_110 });
  const last = row({ commit: commit(3), committed: "2026-11-10T23:59:59.000Z", value: 12_075 });
  const timingEarly = row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", measure: TIMING, unit: "ms", value: 812.5, runs: 5, spread: 0.25 });
  const timingLate = row({ commit: commit(3), committed: "2026-11-10T23:59:59.000Z", measure: TIMING, unit: "ms", value: 790.25, runs: 7, spread: 0.5 });
  await seam.writeReadings(db, [
    last,
    row({ commit: commit(4), committed: "2026-11-11T00:00:00.000Z", value: 99_999 }),
    timingLate,
    first,
    row({ commit: commit(0), committed: "2026-10-31T23:59:59.000Z", value: 99_998 }),
    row({ commit: commit(3), committed: "2026-11-10T23:59:59.000Z", value: 4_210, version: 2 }),
    middle,
    row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 4_200, version: 2 }),
    row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 12_105, machine: "laptop" }),
    row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 6_400, story: BETA }),
    timingEarly,
    row({ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 1, project: `${project}-other` }),
  ]);

  const series = await seam.seriesIn(db, { project, from: "2026-11-01", to: "2026-11-10" });
  const key = (one: MeasureSeries) => `${one.story} ${one.measure} ${one.version} ${one.machine}`;
  const reading = ({ commit: at, committed, value, runs, spread }: ReadingRow): SeriesReading => ({ commit: at, committed, value, runs, spread });
  assert.deepEqual([...series].sort((a, b) => key(a).localeCompare(key(b))), [
    { story: ALPHA, measure: LINES, version: 1, machine: "laptop", unit: "lines", readings: [{ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 12_105, runs: 1, spread: null }] },
    { story: ALPHA, measure: LINES, version: 1, machine: "mint", unit: "lines", readings: [first, middle, last].map(reading) },
    {
      story: ALPHA, measure: LINES, version: 2, machine: "mint", unit: "lines",
      readings: [{ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 4_200, runs: 1, spread: null }, { commit: commit(3), committed: "2026-11-10T23:59:59.000Z", value: 4_210, runs: 1, spread: null }],
    },
    { story: ALPHA, measure: TIMING, version: 1, machine: "mint", unit: "ms", readings: [timingEarly, timingLate].map(reading) },
    { story: BETA, measure: LINES, version: 1, machine: "mint", unit: "lines", readings: [{ commit: commit(2), committed: "2026-11-05T12:00:00.000Z", value: 6_400, runs: 1, spread: null }] },
  ], "one series per story, measure, version and machine, oldest committed first; readings outside the window's days and another project's left out");
});
