// Capability 3 · Measure readings recorded on the box
import { VerbRefusal } from "@storytree/library/verbs";

import { pairMeasures, pairingText, type MeasureReader, type MeasureRecord } from "./pair.js";
import { commitOf, readStoryMeasures } from "./read.js";
import { writeReadings, type MeasureReadingRow, type MeasureReadingsDb } from "./readings.js";

type Stories = Parameters<typeof readStoryMeasures>[0]["stories"];

export async function recordMeasures({ folder, project, machine, stories, records, readers, db }: {
  readonly folder: string;
  readonly project: string;
  readonly machine: string;
  readonly stories: Stories;
  readonly records: readonly MeasureRecord[];
  readonly readers: readonly MeasureReader[];
  readonly db: MeasureReadingsDb;
}): Promise<string> {
  const unpaired = pairMeasures(records, readers).filter(({ unpaired: none }) => none.length > 0);
  if (unpaired.length > 0) {
    const titles = new Map<string, string>([...stories, ...records.map(({ id, fields }) => ({ id, title: String(fields["title"] ?? id) }))].map(({ id, title }) => [id, title]));
    const count = unpaired.reduce((sum, { unpaired: none }) => sum + none.length, 0);
    const text = pairingText(unpaired.map((pairing) => ({ ...pairing, paired: [] })), titles);
    throw new VerbRefusal(`${text}\n\nNothing recorded: ${count} measure${count === 1 ? " does" : "s do"} not pair with one reader at its version in its story's package.`);
  }

  const commit = await commitOf(folder, undefined);
  const short = commit.slice(0, 12);
  const { rows: [last] } = await db.query<{ recorded: boolean | null; at: Date | null; recent: boolean | null }>(
    `SELECT bool_or(commit = $3) AS recorded, max(recorded_at) AS at, max(recorded_at) > now() - interval '1 day' AS recent
      FROM measure_recordings WHERE project = $1 AND machine = $2`,
    [project, machine, commit],
  );
  if (last?.recorded === true) return `Recorded nothing: ${machine} already recorded origin/main at ${short}.`;
  if (last?.recent === true) return `Recorded nothing: ${machine} last recorded at ${last.at?.toISOString()}, less than a day ago, and records at most once a day.`;

  const base = records.filter(({ fields }) => fields["base"] === true && fields["machine"] === machine);
  const reading = await readStoryMeasures({ folder, commit, stories });
  const readAt = new Date().toISOString();
  const rows: MeasureReadingRow[] = [];
  for (const { id, fields } of base) {
    const reader = readers.find(({ measure }) => measure === id);
    if (reader?.read === undefined) throw new Error(`${reader?.package ?? "no package"} declares a reader of ${id} with no read`);
    for (const story of reading.stories) {
      const value = reader.read(story);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      rows.push({
        project, story: story.id, measure: id, version: Number(fields["version"]), value, unit: String(fields["unit"]),
        commit, committed: reading.committed, machine, runs: Number(fields["runs"]), spread: null, readAt,
      });
    }
  }
  await writeReadings(db, rows);
  await db.query(
    `INSERT INTO measure_recordings (project, machine, commit, recorded_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (project, machine, commit) DO UPDATE SET recorded_at = EXCLUDED.recorded_at`,
    [project, machine, commit],
  );
  const s = (n: number) => (n === 1 ? "" : "s");
  return `Recorded ${rows.length} reading${s(rows.length)} of ${base.length} base measure${s(base.length)} read on ${machine}, for ${reading.stories.length} stor${reading.stories.length === 1 ? "y" : "ies"} at origin/main ${short} (${reading.committed.slice(0, 10)}).`;
}
