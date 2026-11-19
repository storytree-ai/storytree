// Capability 3 · Measure readings recorded on the box
import { execFile } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";
import { promisify } from "node:util";

import { pairMeasures, pairingText, type MeasureReader, type MeasureRecord } from "./pair.js";
import { commitOf, readStoryMeasures } from "./read.js";
import { writeReadings, type MeasureReadingRow, type MeasureReadingsDb } from "./readings.js";

type Stories = Parameters<typeof readStoryMeasures>[0]["stories"];

const run = promisify(execFile);

export interface MachineLoad {
  readonly load: number;
  readonly cpus: number;
}

export async function recordMeasures({ folder, project, machine, stories, records, readers, db, plan, server, load = () => ({ load: loadavg()[0]!, cpus: availableParallelism() }) }: {
  readonly folder: string;
  readonly project: string;
  readonly machine: string;
  readonly stories: Stories;
  readonly records: readonly MeasureRecord[];
  readonly readers: readonly MeasureReader[];
  readonly db: MeasureReadingsDb;
  readonly plan: () => Promise<unknown>;
  readonly server?: unknown;
  readonly load?: () => MachineLoad;
}): Promise<string> {
  const pairings = pairMeasures(records, readers);
  const pairedIds = new Set(pairings.flatMap(({ paired }) => paired));
  const pairedRecords = records.filter(({ id }) => pairedIds.has(id));
  const unpaired = pairings.filter(({ unpaired: none }) => none.length > 0).map((pairing) => ({ ...pairing, paired: [] }));
  const titles = new Map<string, string>([...stories, ...records.map(({ id, fields }) => ({ id, title: String(fields["title"] ?? id) }))].map(({ id, title }) => [id, title]));

  const commit = await commitOf(folder, undefined);
  const short = commit.slice(0, 12);
  const lines = [
    await recordBase({ folder, project, machine, stories, records: pairedRecords, readers, db, commit, short }),
    await recordDedicated({ folder, project, machine, records: pairedRecords, readers, db, commit, short, plan, server, load }),
    unpaired.length === 0 ? undefined : pairingText(unpaired, titles),
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

const s = (n: number) => (n === 1 ? "" : "s");

async function recordBase({ folder, project, machine, stories, records, readers, db, commit, short }: {
  readonly folder: string;
  readonly project: string;
  readonly machine: string;
  readonly stories: Stories;
  readonly records: readonly MeasureRecord[];
  readonly readers: readonly MeasureReader[];
  readonly db: MeasureReadingsDb;
  readonly commit: string;
  readonly short: string;
}): Promise<string> {
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
  return `Recorded ${rows.length} reading${s(rows.length)} of ${base.length} base measure${s(base.length)} read on ${machine}, for ${reading.stories.length} stor${reading.stories.length === 1 ? "y" : "ies"} at origin/main ${short} (${reading.committed.slice(0, 10)}).`;
}

async function recordDedicated({ folder, project, machine, records, readers, db, commit, short, plan, server, load }: {
  readonly folder: string;
  readonly project: string;
  readonly machine: string;
  readonly records: readonly MeasureRecord[];
  readonly readers: readonly MeasureReader[];
  readonly db: MeasureReadingsDb;
  readonly commit: string;
  readonly short: string;
  readonly plan: () => Promise<unknown>;
  readonly server: unknown;
  readonly load: () => MachineLoad;
}): Promise<string | undefined> {
  const dedicated = records.filter(({ fields }) => fields["base"] !== true && fields["machine"] === machine);
  if (dedicated.length === 0) return undefined;
  const { rows: [last] } = await db.query<{ recorded: boolean | null; at: Date | null; recent: boolean | null }>(
    `SELECT bool_or(commit = $4) AS recorded, max(read_at) AS at, max(read_at) > now() - interval '1 day' AS recent
      FROM measure_readings WHERE project = $1 AND machine = $2 AND measure = ANY($3)`,
    [project, machine, dedicated.map(({ id }) => id), commit],
  );
  if (last?.recorded === true) return `Recorded nothing dedicated: ${machine} already read them at origin/main ${short}.`;
  if (last?.recent === true) return `Recorded nothing dedicated: ${machine} last read them at ${last.at?.toISOString()}, less than a day ago, and reads them at most once a day.`;
  const machineLoad = load();
  if (machineLoad.load >= machineLoad.cpus) {
    return `Recorded nothing dedicated: ${machine} is busy, its load ${Number(machineLoad.load.toFixed(2))} on ${machineLoad.cpus} CPUs at or over its CPU count; the next run tries again.`;
  }

  const sampled = dedicated.map((record) => ({ record, sample: readers.find(({ measure }) => measure === record.id)?.sample }));
  const unsampled = sampled.filter(({ sample }) => sample === undefined).map(({ record: { id, fields } }) => `${String(fields["title"] ?? id)} (${id})`);
  const rows: MeasureReadingRow[] = [];
  const unread: string[] = [];
  if (unsampled.length < sampled.length) {
    const tree = await plan();
    const committed = new Date((await run("git", ["show", "-s", "--format=%cI", commit], { cwd: folder })).stdout.trim()).toISOString();
    const readAt = new Date().toISOString();
    for (const { record: { id, fields }, sample } of sampled) {
      if (sample === undefined) continue;
      const answer = (await sample({ folder, commit, tree, project, server })) as { value: number; runs: number; spread: number } | undefined;
      if (answer === undefined) {
        unread.push(`${String(fields["title"] ?? id)} (${id})`);
        continue;
      }
      const { value, runs, spread } = answer;
      rows.push({
        project, story: String(fields["story"]), measure: id, version: Number(fields["version"]), value, unit: String(fields["unit"]),
        commit, committed, machine, runs, spread, readAt,
      });
    }
    await writeReadings(db, rows);
  }
  const named = unsampled.length === 0 ? "" : `; no sample, so nothing recorded, for ${unsampled.join(", ")}`;
  const none = unread.length === 0 ? "" : `; no reading at this head, so nothing recorded, for ${unread.join(", ")}`;
  return `Recorded ${rows.length} reading${s(rows.length)} of ${dedicated.length} dedicated measure${s(dedicated.length)} read on ${machine} at origin/main ${short}${named}${none}.`;
}
