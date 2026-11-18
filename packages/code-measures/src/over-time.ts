// Capability 4 · Measures over time per story
import type { MeasureReadingsDb } from "./readings.js";

export type Reads = "not shown" | "shifted up" | "shifted down" | "too few readings";

export interface Limits {
  readonly centre: number;
  readonly lower: number;
  readonly upper: number;
}

export interface Xmr {
  readonly latest: number;
  readonly limits?: Limits;
  readonly reads: Reads;
}

const FEWEST_EARLIER = 5;

export function xmr(values: readonly number[]): Xmr {
  const latest = values[values.length - 1]!;
  const earlier = values.slice(0, -1);
  if (earlier.length < FEWEST_EARLIER) return { latest, reads: "too few readings" };
  const centre = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
  const moving = earlier.slice(1).reduce((sum, value, index) => sum + Math.abs(value - earlier[index]!), 0) / (earlier.length - 1);
  const limits = { centre, lower: centre - 2.66 * moving, upper: centre + 2.66 * moving };
  return { latest, limits, reads: latest > limits.upper ? "shifted up" : latest < limits.lower ? "shifted down" : "not shown" };
}

export interface SeriesReading {
  readonly commit: string;
  readonly committed: string;
  readonly value: number;
  readonly runs: number;
  readonly spread: number | null;
}

export interface MeasureSeries {
  readonly story: string;
  readonly measure: string;
  readonly version: number;
  readonly machine: string;
  readonly unit: string;
  readonly readings: SeriesReading[];
}

export interface Window {
  readonly from: string;
  readonly to: string;
}

export async function seriesIn(db: MeasureReadingsDb, of: Window & { readonly project: string }): Promise<MeasureSeries[]> {
  const { rows } = await db.query<Omit<MeasureSeries, "readings"> & Omit<SeriesReading, "committed"> & { committed: Date }>(
    `SELECT story, measure, version, machine, unit, commit, committed, value, runs, spread
      FROM measure_readings
      WHERE project = $1 AND (committed AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date
      ORDER BY story, measure, version, machine, committed, commit`,
    [of.project, of.from, of.to],
  );
  const series = new Map<string, MeasureSeries>();
  for (const { story, measure, version, machine, unit, commit, committed, value, runs, spread } of rows) {
    const key = JSON.stringify([story, measure, version, machine]);
    const one = series.get(key) ?? { story, measure, version, machine, unit, readings: [] };
    one.readings.push({ commit, committed: committed.toISOString(), value, runs, spread });
    series.set(key, one);
  }
  return [...series.values()];
}

export interface StoryMeasure {
  readonly measure: string;
  readonly title: string;
  readonly base?: true;
  readonly version: number;
  readonly machine: string;
  readonly unit: string;
  readonly readings: readonly SeriesReading[];
  readonly latest?: number;
  readonly limits?: Limits;
  readonly reads?: Reads;
}

export interface LaneCost {
  readonly id: string;
  readonly lanes: number;
  readonly landed: number;
  readonly tokens: { readonly median?: number; readonly range?: readonly [number, number] };
  readonly dollars: { readonly median?: number; readonly range?: readonly [number, number] };
}

export interface StoryOverTime {
  readonly id: string;
  readonly title: string;
  readonly measures: readonly StoryMeasure[];
  readonly lane?: LaneCost;
}

export interface MeasureDefinition {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export function storiesOverTime({ stories, records, series, lanes }: {
  readonly stories: readonly { readonly id: string; readonly title: string }[];
  readonly records: readonly MeasureDefinition[];
  readonly series: readonly MeasureSeries[];
  readonly lanes: readonly LaneCost[];
}): StoryOverTime[] {
  const base = records.filter(({ fields }) => fields["base"] === true);
  return stories.map(({ id, title }) => {
    const own = records.filter(({ fields }) => fields["base"] !== true && fields["story"] === id);
    const measures = [...base, ...own].flatMap((record) => measureOf(record, series.filter((one) => one.story === id && one.measure === record.id)));
    const lane = lanes.find((one) => one.id === id);
    return { id, title, measures, ...(lane === undefined ? {} : { lane }) };
  });
}

function measureOf({ id, fields }: MeasureDefinition, series: readonly MeasureSeries[]): StoryMeasure[] {
  const named = { measure: id, title: String(fields["title"] ?? id), ...(fields["base"] === true ? { base: true as const } : {}) };
  if (series.length === 0) return [{ ...named, version: Number(fields["version"]), machine: String(fields["machine"]), unit: String(fields["unit"]), readings: [] }];
  return series.map(({ version, machine, unit, readings }) => {
    const { latest, limits, reads } = xmr(readings.map(({ value }) => value));
    return { ...named, version, machine, unit, readings, latest, ...(limits === undefined ? {} : { limits }), reads };
  });
}

const number = (value: number): string => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const plural = (count: number, word: string): string => `${number(count)} ${word}${count === 1 ? "" : "s"}`;

function measureLines(one: StoryMeasure): string[] {
  const head = `  ${one.title}${one.base === true ? " (base)" : ""}, version ${one.version} on ${one.machine}`;
  if (one.latest === undefined) return [`${head}: no readings`];
  const limits = one.limits === undefined ? "" : `; limits ${number(one.limits.lower)} to ${number(one.limits.upper)} around ${number(one.limits.centre)}`;
  const series = one.readings.map(({ committed, value, runs, spread }) => `${committed.slice(0, 10)} ${number(value)}${runs > 1 ? ` (${plural(runs, "run")}, spread ${spread === null ? "none" : number(spread)})` : ""}`);
  return [`${head}: latest ${number(one.latest)} ${one.unit} of ${plural(one.readings.length, "reading")}${limits}; ${one.reads}`, `    ${series.join(", ")}`];
}

function laneLine(lane: LaneCost | undefined): string {
  if (lane === undefined) return "  lane cost: no lane in the window";
  const spread = (name: string, { median, range }: LaneCost["tokens"], say: (value: number) => string): string =>
    median === undefined ? `${name} not attributed` : `${name} median ${say(median)}, range ${say(range![0])} to ${say(range![1])}`;
  return `  lane cost: ${plural(lane.lanes, "lane")}, ${number(lane.landed)} landed; ${spread("tokens", lane.tokens, (value) => Math.round(value).toLocaleString("en-GB"))}; ${spread("dollars", lane.dollars, (value) => `$${value.toFixed(2)}`)}`;
}

export function overTimeText(window: Window, stories: readonly StoryOverTime[]): string {
  const head = `Measures over time per story, readings committed ${window.from} to ${window.to} (report only: a latest reading inside the limits of the earlier ones reads not shown).`;
  if (stories.length === 0) return `${head}\nNo story in the plan.`;
  return [head, ...stories.flatMap((story) => ["", `${story.title} (${story.id})`, ...story.measures.flatMap(measureLines), laneLine(story.lane)])].join("\n");
}
