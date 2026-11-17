/**
 * Capability 20 · Lane measures: the summary (contract 20.2). The joined lanes, grouped per story and per capability
 * they touched, each measure given as its median, its middle half and its range over the lanes it was attributed for,
 * with how many lanes that was out of how many. Report only (ADR-1238): it states no verdict, and nothing reads it to
 * decide; a measure is never tuned to pass (ADR-1329 D1). The definitions below are the ones the command's help gives,
 * so the baseline research reads the same numbers week to week.
 */
import type { LaneRow, LaneWindow, Touched } from "./lanes.js";

/** Each generic measure, per lane, as the command's help defines it. */
export const MEASURES: readonly { readonly name: string; readonly means: string }[] = [
  { name: "tokens", means: "every own request's input, cache and output tokens, its subagents' included, of the agent sessions that claimed the increment or a capability under it (9.18's count)" },
  { name: "dollars", means: "those tokens at Anthropic's list price for the model that answered each request (cache writes at 1.25 times input for five minutes, twice for an hour)" },
  { name: "review rounds", means: "the change-reviewer's reviews the QA ledger recorded as taken for the increment" },
  { name: "landed", means: "the share of lanes whose increment closed landed, rather than failed or withdrawn" },
  { name: "fix sessions", means: "fix sessions the watcher started on the increment's pull request going red" },
  { name: "queue reds", means: "times the merge queue removed the increment's pull request for failed checks" },
];

/** The middle of a sorted list, and its quarter points, by linear interpolation. */
function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

/** A measure's spread over the lanes it was found for. */
export interface Spread {
  readonly lanes: number;
  readonly of: number;
  readonly median?: number;
  readonly quartiles?: readonly [number, number];
  readonly range?: readonly [number, number];
}

/** The spread of `values` (undefined where a lane's measure was not found), over `of` lanes. */
export function spreadOf(values: readonly (number | undefined)[]): Spread {
  const found = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (found.length === 0) return { lanes: 0, of: values.length };
  return { lanes: found.length, of: values.length, median: quantile(found, 0.5), quartiles: [quantile(found, 0.25), quantile(found, 0.75)], range: [found[0]!, found[found.length - 1]!] };
}

/** One story's or capability's measures over the lanes that touched it. */
export interface GroupMeasures {
  readonly id: string;
  readonly title: string;
  readonly lanes: number;
  readonly landed: number;
  readonly tokens: Spread;
  readonly dollars: Spread;
  readonly rounds: Spread;
  readonly fixSessions: Spread;
  readonly queueReds: Spread;
}

/** The measures of each story or capability `of` says a lane touched, the most lanes first. */
export function groupMeasures(rows: readonly LaneRow[], of: (row: LaneRow) => readonly Touched[]): GroupMeasures[] {
  const groups = new Map<string, { title: string; rows: LaneRow[] }>();
  for (const row of rows) {
    for (const one of of(row)) {
      const group = groups.get(one.id) ?? { title: one.title, rows: [] };
      group.rows.push(row);
      groups.set(one.id, group);
    }
  }
  return [...groups].map(([id, { title, rows: mine }]) => ({
    id, title, lanes: mine.length,
    landed: mine.filter((row) => row.disposition === "landed").length,
    tokens: spreadOf(mine.map((row) => row.tokens)),
    dollars: spreadOf(mine.map((row) => row.dollars)),
    rounds: spreadOf(mine.map((row) => row.rounds)),
    fixSessions: spreadOf(mine.map((row) => row.fixSessions)),
    queueReds: spreadOf(mine.map((row) => row.queueReds)),
  })).sort((a, b) => b.lanes - a.lanes || a.title.localeCompare(b.title));
}

/** How many of `rows` have `measure` attributed, as "n of m (p%)". */
function share(rows: readonly LaneRow[], measure: keyof LaneRow["unattributed"]): string {
  const found = rows.filter((row) => row.unattributed[measure] === undefined).length;
  return `${found} of ${rows.length} (${Math.round((100 * found) / rows.length)}%)`;
}

const number = (value: number, unit: string): string => unit === "$" ? `$${value.toFixed(2)}` : unit === "tokens" ? `${Math.round(value).toLocaleString("en")}` : `${Math.round(value * 10) / 10}`;

/** One measure's line: median, middle half and range, and the lanes it was attributed for. */
function spreadLine(name: string, spread: Spread, unit: string): string {
  if (spread.median === undefined) return `    ${name}: not attributed for any of ${spread.of} lanes`;
  const say = (value: number): string => number(value, unit);
  return `    ${name}: median ${say(spread.median)}, middle half ${say(spread.quartiles![0])}–${say(spread.quartiles![1])}, range ${say(spread.range![0])}–${say(spread.range![1])} (${spread.lanes} of ${spread.of} lanes)`;
}

function groupLines(group: GroupMeasures): string[] {
  return [
    `  ${group.title} [${group.id}]: ${group.lanes} lane${group.lanes === 1 ? "" : "s"}, ${group.landed} landed (${Math.round((100 * group.landed) / group.lanes)}%)`,
    spreadLine("tokens", group.tokens, "tokens"),
    spreadLine("dollars", group.dollars, "$"),
    spreadLine("review rounds", group.rounds, ""),
    spreadLine("fix sessions", group.fixSessions, ""),
    spreadLine("queue reds", group.queueReds, ""),
  ];
}

/** The report's text: what was counted and attributed, the measures' definitions, per story, per capability, and what was not attributed. */
export function measuresText(rows: readonly LaneRow[], window: LaneWindow): string {
  const head = `Lane measures for increments closed ${window.from} to ${window.to} (report only: nothing gates on these, and none is a verdict).`;
  if (rows.length === 0) return `${head}\nNo increment closed in that window.`;
  const lines = [
    head,
    `${rows.length} increment${rows.length === 1 ? "" : "s"} closed. Attributed: tokens ${share(rows, "tokens")}, dollars ${share(rows, "dollars")}, review rounds ${share(rows, "rounds")}, changed files ${share(rows, "files")}. A measure not attributed is left out of its median, never counted as zero.`,
    "Each measure is per lane:",
    ...MEASURES.map((measure) => `  ${measure.name}: ${measure.means}.`),
    "",
    "Per story (by the increment's capabilities list and the files its pull request changed):",
    ...groupMeasures(rows, (row) => row.stories).flatMap(groupLines),
    "",
    "Per capability:",
    ...groupMeasures(rows, (row) => row.capabilities).flatMap(groupLines),
  ];
  const missing = rows.filter((row) => Object.keys(row.unattributed).length > 0);
  if (missing.length > 0) {
    lines.push("", "Not attributed:");
    for (const row of missing) lines.push(`  ${row.increment} (${row.title}): ${Object.entries(row.unattributed).map(([measure, why]) => `${measure}: ${why}`).join("; ")}`);
  }
  return lines.join("\n");
}
