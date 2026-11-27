// Capability 20 · Lane measures
import type { Library } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
import type { PlacedFile } from "../claims/file-owners.js";
import { ContextFold, readingLines, transcriptOf, type ModelUsage } from "../context/index.js";
import { dollarsOf } from "./prices.js";

export interface LaneWindow {
  readonly from: string;
  readonly to: string;
}

export interface LaneSources {
  prFiles?(pr: number): Promise<readonly string[] | undefined>;
  placeFiles?(paths: readonly string[]): Promise<readonly PlacedFile[]>;
  reviewRounds?(increments: readonly string[]): Promise<ReadonlyMap<string, number> | undefined>;
}

export interface Touched {
  readonly id: string;
  readonly title: string;
  readonly by: "list" | "files" | "both";
}

export interface Unattributed {
  tokens?: string;
  dollars?: string;
  rounds?: string;
  files?: string;
}

export interface Caveats {
  tokens?: string;
  dollars?: string;
}

export interface LaneRow {
  readonly increment: string;
  readonly title: string;
  readonly closed: string;
  readonly disposition: "landed" | "failed" | "withdrawn";
  readonly pr?: number;
  readonly sessions: readonly string[];
  readonly tokens?: number;
  readonly dollars?: number;
  readonly rounds?: number;
  readonly fixSessions: number;
  readonly queueReds: number;
  readonly stories: readonly Touched[];
  readonly capabilities: readonly Touched[];
  readonly unattributed: Unattributed;
  readonly caveats: Caveats;
}

const PULL_HOLDER = /^pull-request-\d+$/;

interface Spend {
  tokens: number;
  bill?: Map<string, ModelUsage>;
}

function timeOf(line: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    const stamp = typeof parsed === "object" && parsed !== null ? (parsed as { timestamp?: unknown }).timestamp : undefined;
    const time = typeof stamp === "string" ? Date.parse(stamp) : NaN;
    return Number.isNaN(time) ? undefined : time;
  } catch {
    return undefined;
  }
}

async function sessionSpend(log: ActivityLog, project: string, session: string, claims: readonly (readonly [string, number])[]): Promise<Map<string, Spend> | undefined> {
  const parts = [...(await log.transcripts.cursors(project, session)).keys()];
  if (parts.length === 0) return undefined;
  const harness = transcriptOf(await readingLines(log, project, [session]), session)?.harness;
  const spends = new Map<string, Spend>(claims.map(([increment]) => [increment, { tokens: 0, bill: new Map() }]));
  const owner = (time: number | undefined, before: string): string => {
    if (time === undefined) return before;
    return claims.findLast(([, at]) => at <= time)?.[0] ?? claims[0]![0];
  };
  for (const part of parts) {
    const text = (await log.transcripts.text(project, session, part)) ?? "";
    const fold = new ContextFold(harness, { subagent: part !== "" });
    const runs: { increment: string; lines: string[] }[] = [];
    let increment = claims[0]![0];
    for (const line of text.split("\n").filter((one) => one.includes('"usage"') || one.includes('"token_count"'))) {
      increment = claims.length === 1 ? increment : owner(timeOf(line), increment);
      const last = runs.at(-1);
      if (last?.increment === increment) last.lines.push(line);
      else runs.push({ increment, lines: [line] });
    }
    let spent = 0;
    let billed = new Map<string, ModelUsage>();
    for (const run of runs) {
      fold.feed(run.lines.join("\n"));
      const spend = spends.get(run.increment)!;
      spend.tokens += fold.spent() - spent;
      spent = fold.spent();
      const bill = fold.bill();
      if (bill === undefined) continue;
      for (const [model, usage] of bill) spend.bill?.set(model, add(spend.bill.get(model), minus(usage, billed.get(model))));
      billed = bill;
    }
    if (fold.bill() === undefined) for (const spend of spends.values()) delete spend.bill;
  }
  return spends;
}

function minus(usage: ModelUsage, before: ModelUsage | undefined): ModelUsage {
  if (before === undefined) return usage;
  return { input: usage.input - before.input, cacheRead: usage.cacheRead - before.cacheRead, cacheWrite5m: usage.cacheWrite5m - before.cacheWrite5m, cacheWrite1h: usage.cacheWrite1h - before.cacheWrite1h, output: usage.output - before.output };
}

function add(sum: ModelUsage | undefined, usage: ModelUsage): ModelUsage {
  if (sum === undefined) return { ...usage };
  return { input: sum.input + usage.input, cacheRead: sum.cacheRead + usage.cacheRead, cacheWrite5m: sum.cacheWrite5m + usage.cacheWrite5m, cacheWrite1h: sum.cacheWrite1h + usage.cacheWrite1h, output: sum.output + usage.output };
}

function prNumber(pr: string | undefined): number | undefined {
  const match = /^#?(\d+)$/.exec(pr?.trim() ?? "");
  return match === null ? undefined : Number(match[1]);
}

function touched(list: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>): Touched[] {
  const ids = new Set([...list.keys(), ...files.keys()]);
  return [...ids].map((id) => ({ id, title: list.get(id) ?? files.get(id)!, by: list.has(id) ? (files.has(id) ? "both" : "list") : "files" }));
}

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
  const allSessions = [...new Set([...sessionsOf.values()].flatMap((set) => [...set]))];
  const drove = new Map<string, Map<string, number>>();
  if (allSessions.length > 0) {
    for (const line of await log.lines(project, { kinds: ["claimed"], sessions: allSessions })) {
      if (line.kind !== "claimed") continue;
      const increment = line.increment ?? line.under;
      if (increment === undefined) continue;
      const first = drove.get(line.session) ?? new Map<string, number>();
      const at = Date.parse(line.at);
      const seen = first.get(increment);
      if (seen === undefined || at < seen) first.set(increment, at);
      drove.set(line.session, first);
    }
  }
  const spends = new Map<string, Map<string, Spend> | undefined>();
  const queue = [...allSessions];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let session = queue.shift(); session !== undefined; session = queue.shift()) {
      const claims = [...drove.get(session)!].sort((a, b) => a[1] - b[1]);
      spends.set(session, await sessionSpend(log, project, session, claims));
    }
  }));
  const rounds = sources.reviewRounds === undefined ? undefined : await sources.reviewRounds(ids);
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
    const caveats: Caveats = {};
    const read = sessions.filter((session) => spends.get(session) !== undefined);
    const unread = sessions.filter((session) => spends.get(session) === undefined);
    if (sessions.length === 0) unattributed.tokens = unattributed.dollars = "no agent session claimed it";
    else if (read.length === 0) unattributed.tokens = unattributed.dollars = `session ${unread[0]} has no transcript stored in the log`;
    else {
      const notes = [
        ...read.filter((session) => drove.get(session)!.size > 1).map((session) => `session ${session} drove ${drove.get(session)!.size} increments; each request is counted toward the increment it had claimed most recently`),
        ...unread.map((session) => `a lower bound: session ${session} has no transcript stored in the log`),
      ];
      if (notes.length > 0) caveats.tokens = notes.join("; ");
      const found = read.map((session) => spends.get(session)!.get(increment.id)!);
      tokens = found.reduce((sum, spend) => sum + spend.tokens, 0);
      if (found.some((spend) => spend.bill === undefined)) unattributed.dollars = "a session's harness names no per-model split of its spend";
      else {
        const bill = new Map<string, ModelUsage>();
        for (const spend of found) for (const [model, usage] of spend.bill!) bill.set(model, add(bill.get(model), usage));
        const priced = dollarsOf(bill);
        if ("dollars" in priced) dollars = priced.dollars;
        else unattributed.dollars = `no list price for ${priced.unpriced.join(", ")}`;
      }
      if (dollars !== undefined && caveats.tokens !== undefined) caveats.dollars = caveats.tokens;
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
      caveats,
    });
  }
  return rows.sort((a, b) => a.closed.localeCompare(b.closed) || a.increment.localeCompare(b.increment));
}
