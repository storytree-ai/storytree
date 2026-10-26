/**
 * Capability 3 · Arc surface. `arc recent`: what landed since a time, grouped by arc, each landing with its pull
 * request, then the arcs that closed since then (contracts 3.15 and 3.16), for the session manager's "since last run"
 * entry (ADR-1103 D6). Read from the increments' closures in the library, never GitHub: the Mint watcher closes an
 * increment when its pull request merges, so this needs no `gh` and counts only planned work.
 */
import { verb } from "@storytree/library/verbs";

import { beforeCutover, pullSaid, type BoardIncrement, type PrCutover } from "@storytree/library";
import type { ArcVerbContext } from "./context.js";
import { sinceOf, timeSaid } from "./status.js";

const DAY_MS = 86_400_000;

/** The UTC day of `at` (YYYY-MM-DD), as an outcome's date is written. */
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * A pull request as the line says it: `#n`, however the closure wrote it, or the old repository's `owner/name#n` when
 * it closed before the repository cut-over, so that `(#n)` only ever names the project's repository's pull request.
 */
const prSaid = (cutover: PrCutover | undefined, increment: BoardIncrement): string => {
  const { pr, date } = increment.fields.outcome ?? {};
  if (pr === undefined) return "no pull request";
  if (date !== undefined && beforeCutover(cutover, date)) return pullSaid(cutover, pr, date);
  return /^\d+$/.test(pr) ? `#${pr}` : pr;
};

/**
 * Closed since `since`: its outcome's day (a day only) is no earlier than since's, and the record last changed no
 * earlier than since, as `arc status` counts a landing.
 */
const closedSince = (increment: BoardIncrement, since: number): boolean =>
  increment.fields.status === "closed" && (increment.fields.outcome?.date ?? "") >= dayOf(since) && Date.parse(increment.updatedAt) >= since;

export const recent = verb({
  command: {
    family: "arc",
    name: "recent",
    summary: "what landed since a time, grouped by arc, with pull requests, then the arcs that closed; read from increment closures, not GitHub, so it needs no gh and counts only planned work",
    usage: "arc recent [--since <time|30m|2h|1d>]",
  },
  tool: { absent: "the MCP server's own show_plan shows the plan" },
  inputs: { since: { kind: "text", optional: true, describe: "count landings from this time, or this span back (30m, 2h, 1d); 24 hours by default" } },
  async act({ since: given }, { library }: ArcVerbContext) {
    const now = Date.now();
    const since = sinceOf(given, now, DAY_MS);
    const said = timeSaid(new Date(since).toISOString());
    // One read: the live arcs, and the closed ones whose closing day is since's or later.
    const [arcs, cutover] = await Promise.all([library.boardArcs({ from: dayOf(since), to: dayOf(now + DAY_MS) }), library.prCutover()]);
    const landed = arcs
      .map(({ arc, increments }) => ({ arc, landings: increments.filter((increment) => increment.fields.outcome?.disposition === "landed" && closedSince(increment, since)) }))
      .filter(({ landings }) => landings.length > 0);
    const closed = arcs.filter(({ state, increments }) => state === "closed" && increments.some((increment) => closedSince(increment, since)));
    const count = landed.reduce((sum, { landings }) => sum + landings.length, 0);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const lines = [
      ...(count === 0
        ? [`Nothing landed since ${said}.`]
        : [
            `${count} landed since ${said}, on ${plural(landed.length, "arc")}:`,
            ...landed.flatMap(({ arc, landings }) => [
              `  ${arc.id}  ${arc.fields.title}`,
              ...landings.map((increment) => `    ${increment.id}  ${increment.fields.title} (${prSaid(cutover, increment)})`),
            ]),
          ]),
      ...(closed.length === 0 ? [] : [`${plural(closed.length, "arc")} closed since then:`, ...closed.map(({ arc, closed: day }) => `  ${arc.id}  ${arc.fields.title} (closed ${day})`)]),
    ];
    return { text: lines.join("\n"), next: [{ command: "arc show <arc>", why: "see one whole" }] };
  },
});
