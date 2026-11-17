/**
 * Capability 20 · Lane measures: the join (contract 20.1). For each increment closed in a window, the lane that drove it,
 * put together from what is already recorded: the agent sessions that claimed it or a capability under it (the watcher's
 * own holds left out), each one's spend from its stored transcript records (9.18's fold, its subagents' included) and its
 * list-price dollars; the fix sessions the watcher started (pr-red lines) and the merge queue's reds (queue-red lines);
 * its review rounds, from the part that keeps a QA ledger; and the stories and capabilities it touched, by its capabilities
 * list and by the files its pull request changed. A measure it cannot find for an increment is unattributed, with why,
 * never a zero. It reads and decides nothing (ADR-1238).
 */
import type { Library } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
import type { PlacedFile } from "../claims/file-owners.js";
import { ContextFold, readingLines, transcriptOf, type ModelUsage } from "../context/index.js";
import { dollarsOf } from "./prices.js";

/** The days increments closed on to be counted, inclusive, each YYYY-MM-DD. */
export interface LaneWindow {
  readonly from: string;
  readonly to: string;
}

/** What the reading is handed by its door, since Session management reads neither git, the map nor the QA ledger itself. */
export interface LaneSources {
  /** The files pull request `pr` changed, or undefined when its merge is not found. */
  prFiles?(pr: number): Promise<readonly string[] | undefined>;
  /** Where each of `paths` belongs, by the map's placement. */
  placeFiles?(paths: readonly string[]): Promise<readonly PlacedFile[]>;
  /** The review rounds the QA ledger holds for each of `increments`, one it holds none for counting 0; undefined when no part keeps a ledger here. */
  reviewRounds?(increments: readonly string[]): Promise<ReadonlyMap<string, number> | undefined>;
}

/** A story or capability a lane touched, and how it is known: by the increment's capabilities list, the files its pull request changed, or both. */
export interface Touched {
  readonly id: string;
  readonly title: string;
  readonly by: "list" | "files" | "both";
}

/** The measures the reading could not attribute for one increment, each with why. */
export interface Unattributed {
  tokens?: string;
  dollars?: string;
  rounds?: string;
  files?: string;
}

/** One closed increment's lane, joined. */
export interface LaneRow {
  readonly increment: string;
  readonly title: string;
  readonly closed: string;
  readonly disposition: "landed" | "failed" | "withdrawn";
  readonly pr?: number;
  /** The agent sessions that claimed it or a capability under it. */
  readonly sessions: readonly string[];
  readonly tokens?: number;
  readonly dollars?: number;
  readonly rounds?: number;
  /** Fix sessions the watcher started on its pull request's reds. */
  readonly fixSessions: number;
  /** Times the merge queue removed its pull request for failed checks. */
  readonly queueReds: number;
  readonly stories: readonly Touched[];
  readonly capabilities: readonly Touched[];
  readonly unattributed: Unattributed;
}

/** The session holding a handed-over pull request for the watcher, which is no agent's. */
const PULL_HOLDER = /^pull-request-\d+$/;

/** One session's spend: its tokens, and its bill by model when its harness names one. */
interface Spend {
  readonly tokens: number;
  readonly bill?: Map<string, ModelUsage>;
}

/** `session`'s spend from every part of its stored transcript, its own and its subagents'; undefined when none is stored. */
async function sessionSpend(log: ActivityLog, project: string, session: string): Promise<Spend | undefined> {
  const parts = [...(await log.transcripts.cursors(project, session)).keys()];
  if (parts.length === 0) return undefined;
  const harness = transcriptOf(await readingLines(log, project, [session]), session)?.harness;
  let tokens = 0;
  let bill: Map<string, ModelUsage> | undefined = new Map();
  for (const part of parts) {
    // Only a line carrying a request's usage or a running token count adds to the spend: the rest is left unparsed.
    const text = (await log.transcripts.text(project, session, part)) ?? "";
    const fold = new ContextFold(harness, { subagent: part !== "" }).feed(text.split("\n").filter((line) => line.includes('"usage"') || line.includes('"token_count"')).join("\n"));
    tokens += fold.spent();
    const billed = fold.bill();
    if (billed === undefined) bill = undefined;
    else if (bill !== undefined) for (const [model, usage] of billed) bill.set(model, add(bill.get(model), usage));
  }
  return bill === undefined ? { tokens } : { tokens, bill };
}

function add(sum: ModelUsage | undefined, usage: ModelUsage): ModelUsage {
  if (sum === undefined) return { ...usage };
  return { input: sum.input + usage.input, cacheRead: sum.cacheRead + usage.cacheRead, cacheWrite5m: sum.cacheWrite5m + usage.cacheWrite5m, cacheWrite1h: sum.cacheWrite1h + usage.cacheWrite1h, output: sum.output + usage.output };
}

/** The pull request's number an outcome names ("#12" or "12"), or undefined. */
function prNumber(pr: string | undefined): number | undefined {
  const match = /^#?(\d+)$/.exec(pr?.trim() ?? "");
  return match === null ? undefined : Number(match[1]);
}

/** Merge what a lane touched by its list and by its files into one list, each saying how it is known. */
function touched(list: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>): Touched[] {
  const ids = new Set([...list.keys(), ...files.keys()]);
  return [...ids].map((id) => ({ id, title: list.get(id) ?? files.get(id)!, by: list.has(id) ? (files.has(id) ? "both" : "list") : "files" }));
}

/** Each increment closed in `window`, its lane joined to what it spent, its review rounds, its pass measures and what it touched. */
export async function laneRows(context: { log: ActivityLog; library: Library; project: string }, window: LaneWindow, sources: LaneSources = {}): Promise<LaneRow[]> {
  const { log, library, project } = context;
  const closed = (await library.list("increment")).filter((one) => {
    const day = one.fields.outcome?.date;
    return day !== undefined && day >= window.from && day <= window.to;
  });
  if (closed.length === 0) return [];
  const ids = closed.map((one) => one.id);
  const tree = await library.projectTree();
  const capabilityOf = new Map(tree.stories.flatMap((story) => story.capabilities.map((capability) => [capability.id, { title: capability.title, story }] as const)));

  const [own, under, reds, queued] = await Promise.all([
    log.lines(project, { kinds: ["claimed"], where: { increment: ids } }),
    log.lines(project, { kinds: ["claimed"], where: { under: ids } }),
    log.lines(project, { kinds: ["pr-red"], where: { increment: ids } }),
    log.lines(project, { kinds: ["queue-red"], where: { increment: ids } }),
  ]);
  const sessionsOf = new Map<string, Set<string>>();
  for (const line of [...own, ...under]) {
    if (line.kind !== "claimed" || line.harness === "watcher" || PULL_HOLDER.test(line.session)) continue;
    const increment = line.increment ?? line.under;
    if (increment === undefined) continue;
    const set = sessionsOf.get(increment) ?? new Set<string>();
    set.add(line.session);
    sessionsOf.set(increment, set);
  }
  // A session that claimed more than one increment drove them all from one transcript, so its spend cannot be split.
  const allSessions = [...new Set([...sessionsOf.values()].flatMap((set) => [...set]))];
  const drove = new Map<string, Set<string>>();
  if (allSessions.length > 0) {
    for (const line of await log.lines(project, { kinds: ["claimed"], sessions: allSessions })) {
      if (line.kind !== "claimed") continue;
      const increment = line.increment ?? line.under;
      if (increment === undefined) continue;
      const set = drove.get(line.session) ?? new Set<string>();
      set.add(increment);
      drove.set(line.session, set);
    }
  }
  // A few sessions at a time, so a window of hundreds of lanes never holds every transcript at once.
  const spends = new Map<string, Spend | undefined>();
  const queue = [...allSessions];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let session = queue.shift(); session !== undefined; session = queue.shift()) spends.set(session, await sessionSpend(log, project, session));
  }));
  const rounds = sources.reviewRounds === undefined ? undefined : await sources.reviewRounds(ids);
  // Every pull request's files placed in one call: placing surveys the whole checkout, so once, not once a pull request.
  const filesOf = new Map<number, readonly string[] | undefined>();
  if (sources.prFiles !== undefined) {
    for (const pr of new Set(closed.map((one) => prNumber(one.fields.outcome!.pr)))) if (pr !== undefined) filesOf.set(pr, await sources.prFiles(pr));
  }
  const allFiles = [...new Set([...filesOf.values()].flatMap((files) => files ?? []))];
  const placedOf = new Map(sources.placeFiles === undefined || allFiles.length === 0 ? [] : (await sources.placeFiles(allFiles)).map((placed) => [placed.file, placed] as const));

  const rows: LaneRow[] = [];
  for (const increment of closed) {
    const outcome = increment.fields.outcome!;
    const pr = prNumber(outcome.pr);
    const sessions = [...(sessionsOf.get(increment.id) ?? [])].sort();
    const unattributed: Unattributed = {};

    let tokens: number | undefined;
    let dollars: number | undefined;
    const shared = sessions.find((session) => (drove.get(session)?.size ?? 0) > 1);
    const unstored = sessions.find((session) => spends.get(session) === undefined);
    if (sessions.length === 0) unattributed.tokens = unattributed.dollars = "no agent session claimed it";
    else if (shared !== undefined) unattributed.tokens = unattributed.dollars = `session ${shared} drove ${drove.get(shared)!.size} increments, so its spend cannot be split`;
    else if (unstored !== undefined) unattributed.tokens = unattributed.dollars = `session ${unstored} has no transcript stored in the log`;
    else {
      const found = sessions.map((session) => spends.get(session)!);
      tokens = found.reduce((sum, spend) => sum + spend.tokens, 0);
      if (found.some((spend) => spend.bill === undefined)) unattributed.dollars = "a session's harness names no per-model split of its spend";
      else {
        const bill = new Map<string, ModelUsage>();
        for (const spend of found) for (const [model, usage] of spend.bill!) bill.set(model, add(bill.get(model), usage));
        const priced = dollarsOf(bill);
        if ("dollars" in priced) dollars = priced.dollars;
        else unattributed.dollars = `no list price for ${priced.unpriced.join(", ")}`;
      }
    }

    const round = rounds?.get(increment.id) ?? (rounds === undefined ? undefined : 0);
    if (round === undefined) unattributed.rounds = "no part keeping a QA ledger is mounted here";

    const listCapabilities = new Map<string, string>();
    const listStories = new Map<string, string>();
    for (const id of increment.fields.capabilities ?? []) {
      const found = capabilityOf.get(id);
      if (found === undefined) continue;
      listCapabilities.set(id, found.title);
      listStories.set(found.story.id, found.story.title);
    }
    const fileCapabilities = new Map<string, string>();
    const fileStories = new Map<string, string>();
    const files = pr === undefined ? undefined : filesOf.get(pr);
    if (pr === undefined) unattributed.files = "its outcome names no pull request";
    else if (sources.prFiles === undefined || sources.placeFiles === undefined) unattributed.files = "no git history or map placement was handed in";
    else if (files === undefined) unattributed.files = `pull request #${pr}'s merge is not on the checkout's main line`;
    else {
      for (const placed of files.map((file) => placedOf.get(file)).filter((one) => one !== undefined)) {
        if (placed.story !== undefined) fileStories.set(placed.story.id, placed.story.title);
        if (placed.capability !== undefined) fileCapabilities.set(placed.capability, capabilityOf.get(placed.capability)?.title ?? placed.capability);
      }
    }

    rows.push({
      increment: increment.id,
      title: increment.fields.title,
      closed: outcome.date,
      disposition: outcome.disposition,
      ...(pr === undefined ? {} : { pr }),
      sessions,
      ...(tokens === undefined ? {} : { tokens }),
      ...(dollars === undefined ? {} : { dollars }),
      ...(round === undefined ? {} : { rounds: round }),
      fixSessions: reds.filter((line) => line.kind === "pr-red" && line.increment === increment.id).length,
      queueReds: queued.filter((line) => line.kind === "queue-red" && line.increment === increment.id).length,
      stories: touched(listStories, fileStories),
      capabilities: touched(listCapabilities, fileCapabilities),
      unattributed,
    });
  }
  return rows.sort((a, b) => a.closed.localeCompare(b.closed) || a.increment.localeCompare(b.increment));
}
