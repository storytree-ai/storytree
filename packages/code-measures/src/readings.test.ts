// Capability 3 · Measure readings recorded on the box
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Storytree } from "@storytree/library";

import * as codeMeasures from "./index.js";

interface MeasureReadingRow {
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

interface ReadingsDb {
  query(text: string, values?: unknown[]): Promise<{ rows: object[] }>;
}

interface ReadingsSeam {
  MEASURE_READINGS_DATABASE: string;
  measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<ReadingsDb>;
  writeReadings(db: ReadingsDb, rows: readonly MeasureReadingRow[]): Promise<void>;
  measureSeries(db: ReadingsDb, of: { project: string; story: string; measure: string; version: number }): Promise<MeasureReadingRow[]>;
}

const seam = codeMeasures as unknown as ReadingsSeam;

async function server(t: TestContext): Promise<Storytree> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  t.after(() => storytree.close());
  return storytree;
}

const STORY = "story_a1a1a1a1a1a1";
const MEASURE = "measure_100000000001";
const [C1, C2, C3] = ["c1".repeat(20), "c2".repeat(20), "c3".repeat(20)];

test("3.1 · writing a reading again at the same project, story, measure, version, commit and machine replaces it, and a story's series for a measure and version is that version's readings only, oldest commit first", async (t) => {
  assert.equal(seam.MEASURE_READINGS_DATABASE, "storytree-measure-readings", "the readings are kept in a database of their own");
  const db = await seam.measureReadingsPool(await server(t));
  const project = `t-${randomBytes(4).toString("hex")}`;
  const reading = (fields: Partial<MeasureReadingRow> & Pick<MeasureReadingRow, "commit" | "committed" | "value">): MeasureReadingRow => ({
    project, story: STORY, measure: MEASURE, version: 1, unit: "lines", machine: "mint", runs: 1, spread: null, readAt: "2026-11-18T06:00:00.000Z", ...fields,
  });

  const atC1 = reading({ commit: C1, committed: "2026-11-01T12:00:00.000Z", value: 1200 });
  const atC2 = reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 1260.5, runs: 5, spread: 0.25, readAt: "2026-11-18T07:00:00.000Z" });
  const atC3 = reading({ commit: C3, committed: "2026-11-02T12:00:00.000Z", value: 1230 });
  await seam.writeReadings(db, [atC2, atC1]);
  await seam.writeReadings(db, [
    atC3,
    reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 99, version: 2 }),
    reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 98, story: "story_b2b2b2b2b2b2" }),
    reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 97, measure: "measure_100000000002" }),
    reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 96, project: `${project}-other` }),
  ]);
  const again = { ...atC1, value: 1210, readAt: "2026-11-19T06:00:00.000Z" };
  await seam.writeReadings(db, [again]);

  const of = { project, story: STORY, measure: MEASURE, version: 1 };
  assert.deepEqual(await seam.measureSeries(db, of), [again, atC3, atC2], "c1's reading replaced, not added to; oldest commit first; no other version, story, measure or project");

  const laptop = { ...atC1, machine: "laptop", value: 1190 };
  await seam.writeReadings(db, [laptop]);
  const series = await seam.measureSeries(db, of);
  assert.deepEqual(series.map(({ commit }) => commit), [C1, C1, C3, C2], "another machine's reading at the same commit is a row of its own");
  assert.deepEqual(series.slice(0, 2).sort((a, b) => a.machine.localeCompare(b.machine)), [laptop, again]);

  assert.deepEqual(await seam.measureSeries(db, { ...of, version: 2 }), [reading({ commit: C2, committed: "2026-11-03T12:00:00.000Z", value: 99, version: 2 })], "version 2's series holds version 2's reading alone");
});
