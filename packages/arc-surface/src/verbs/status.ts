/**
 * Capability 3 · Arc surface. `arc status`: one line per active arc, those moving first, each with its state and why
 * (contracts 3.13 and 3.14), for the session manager's per-run reading of which arcs move and why the others do not.
 * Every state is the board's own (`boardView`, from one read of the board's arcs and one of the holds, and the claims
 * standing in the activity log): this only sorts its lanes into Working, Landed, Ready, Waiting on you, Blocked and
 * Idle, and says why in words.
 */
import { holdersOf, LogFold, LONGEST_COMMAND_MS } from "@storytree/session-management/readings";
import { verb, VerbRefusal } from "@storytree/library/verbs";

import { boardView, type Bar, type Lane } from "../board/board.js";
import { recentWindow } from "../board/closed-range.js";
import type { ArcVerbContext } from "./context.js";

/** The states, strongest first: the order the lines print in. */
const STATES = ["Working", "Landed", "Ready", "Waiting on you", "Blocked", "Idle"] as const;
type Status = (typeof STATES)[number];

const SPAN = /^(\d+)([mhd])$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** `--since`: a time, or a span back from `now` (30m, 2h, 1d); not given, `fallback` back (two hours unless said). Shared with `arc recent`. */
export function sinceOf(given: string | undefined, now: number, fallback = 2 * UNIT_MS.h): number {
  if (given === undefined) return now - fallback;
  const span = SPAN.exec(given);
  if (span !== null) return now - Number(span[1]) * UNIT_MS[span[2] as keyof typeof UNIT_MS];
  const at = /^\d{4}-\d{2}-\d{2}/.test(given) ? Date.parse(given) : NaN;
  if (Number.isNaN(at)) throw new VerbRefusal(`--since is a time (2026-10-21T09:00Z) or a span back from now (30m, 2h, 1d); not "${given}"`);
  return at;
}

/** A time as the line says it: to the minute, in UTC. */
export const timeSaid = (at: string): string => `${at.slice(0, 16).replace("T", " ")} UTC`;

const named = (bar: Pick<Bar, "id" | "title">): string => `${bar.id} ${bar.title}`;

/** What an open increment nobody holds waits for, in words: the owner's questions and waits, other work, events, or a capability another holds. */
function waitsSaid(bar: Bar): string {
  const said = [
    ...(bar.reading.state === "waiting-on-you"
      ? [
          ...bar.questionsBehind.map((title) => `question "${title}" (through other work)`),
          ...bar.noteWaits.filter(({ releaser, holds }) => releaser === "owner" && holds).map(({ note }) => note),
        ]
      : []),
    ...bar.waits.map((wait) => `waits on ${wait.id} ${wait.title}${wait.reason ? ` (${wait.reason})` : ""}${wait.forGood ? ", which never releases" : ""}`),
    ...bar.noteWaits.filter(({ releaser, holds }) => releaser === "event" && holds).map(({ note, checkBack }) => `waits for ${note} until ${checkBack}`),
    ...(bar.blockedBy ? [`${named(bar.blockedBy)} holds a capability it lists`] : []),
  ];
  return said.length > 0 ? said.join(", ") : "waiting on you";
}

/** What the lines are said from beside the board: each holder's machine, each question's title, and the open questions each increment is held on (the library's heldOn reading). */
interface Names {
  readonly machines: ReadonlyMap<string, string>;
  readonly questionTitles: ReadonlyMap<string, string>;
  readonly heldOn: Readonly<Record<string, readonly string[]>>;
}

/** One lane's state and why, from the board's reading of it: landings counted from `since`, holders named with their machines. */
function statusOf(lane: Lane, since: number, { machines, questionTitles, heldOn }: Names): { state: Status; why: string } {
  const open = lane.bars.filter(({ reading }) => reading.state !== "landed" && reading.state !== "not-completed");
  const landed = lane.view.increments
    .filter((increment) => increment.fields.status === "closed" && increment.fields.outcome?.disposition === "landed" && Date.parse(increment.updatedAt) >= since)
    .map((increment) => `${increment.id} ${increment.fields.title} (${increment.fields.outcome?.pr ?? "no pull request"})`);
  const titleOf = (id: string) => lane.bars.find((bar) => bar.id === id)?.title ?? id;
  // Each increment held, by its own claim or else by a capability claim taken under it (ADR-0949 D1).
  const holders = lane.agents.filter(({ increment }) => increment !== undefined);
  const working = (holders.length > 0 ? holders : lane.agents).map((agent) => {
    const id = agent.increment ?? agent.under!;
    const machine = machines.get(agent.session);
    const who = machine === undefined && agent.activity.startsWith("held for") ? agent.activity : `${agent.label} session ${agent.session}${machine === undefined ? "" : ` on ${machine}`}`;
    return `${id} ${titleOf(id)}: ${who} since ${timeSaid(agent.since)}${agent.holder === "idle" ? `, idle ${agent.quietMinutes} min` : ""}`;
  });
  const free = open.filter(({ reading }) => reading.state === "open");
  const owner = open.filter(({ reading }) => reading.state === "waiting-on-you");
  const rest = (): { state: Status; why: string } => {
    if (free.length > 0) return { state: "Ready", why: `nobody holds ${free.map(named).join(", ")}` };
    const waiting = open.filter(({ reading }) => reading.state !== "held");
    if (waiting.length > 0) {
      const why = waiting.map((bar) => `${named(bar)}: ${bar.reading.state === "waiting-on-you" && (bar.reading.behind ?? []).length === 0 ? ownerSaid(bar, heldOn[bar.id] ?? [], questionTitles) : waitsSaid(bar)}`).join("; ");
      return { state: owner.length === waiting.length ? "Waiting on you" : "Blocked", why };
    }
    const asked = lane.view.questions.filter(({ fields }) => fields.lifecycle === "open").map(({ fields }) => `question "${fields.title}"`);
    return asked.length > 0 ? { state: "Waiting on you", why: asked.join(", ") } : { state: "Idle", why: "nothing parked" };
  };
  if (working.length > 0) return { state: "Working", why: `${working.join("; ")}${landed.length > 0 ? `; also landed ${landed.join(", ")}` : ""}` };
  if (landed.length > 0) {
    const next = rest();
    return { state: "Landed", why: `${landed.join(", ")}; next: ${next.state.toLowerCase()}, ${next.why}` };
  }
  return rest();
}

/** An increment held on the owner directly: the titles of the questions it is held on, and the notes of the owner's waits on it. */
function ownerSaid(bar: Bar, held: readonly string[], questionTitles: ReadonlyMap<string, string>): string {
  const asked = held.map((id) => `question "${questionTitles.get(id) ?? id}"`);
  const notes = bar.noteWaits.filter(({ releaser, holds }) => releaser === "owner" && holds).map(({ note }) => note);
  return [...asked, ...notes].join(", ") || "waiting on you";
}

export const status = verb({
  command: {
    family: "arc",
    name: "status",
    summary: "one line per active arc, moving ones first: working, landed since a time, ready, waiting on you, blocked or idle, and why",
    usage: "arc status [--since <time|30m|2h|1d>]",
  },
  tool: { absent: "the MCP server's own show_plan shows the plan" },
  inputs: { since: { kind: "text", optional: true, describe: "count landings from this time, or this span back (30m, 2h, 1d); two hours by default" } },
  async act({ since: given }, { library, log, project }: ArcVerbContext) {
    const now = Date.now();
    const since = sinceOf(given, now);
    // One read of the board's arcs, one of every hold, and the claims standing with their holders' recent lines.
    const [arcs, { waits, heldOn, waitsFor }, claimLines] = await Promise.all([library.boardArcs(recentWindow(now)), library.holds(), log.standing(project)]);
    const holders = holdersOf(claimLines);
    const lines = holders.length === 0 ? [] : await log.foldLines(project, holders, new Date(now - LONGEST_COMMAND_MS - 60_000).toISOString());
    const fold = LogFold.fromBounded(lines, claimLines);
    const machines = new Map(fold.sessions({ now: new Date(now) }).flatMap(({ session, machine }): [string, string][] => (machine === undefined ? [] : [[session, machine]])));
    const board = boardView({ arcs: [...arcs], waits: { ...waits }, heldOn: { ...heldOn }, waitsFor: { ...waitsFor } }, { fold, lines }, new Date(now), "active");
    const questionTitles = new Map(arcs.flatMap(({ questions }) => questions.map((question): [string, string] => [question.id, question.fields.title])));
    const said = board.lanes.map((lane) => ({ lane, ...statusOf(lane, since, { machines, questionTitles, heldOn }) }));
    // The board's order (priority first) within each state; a stable sort keeps it.
    said.sort((one, other) => STATES.indexOf(one.state) - STATES.indexOf(other.state));
    if (said.length === 0) return { text: "No active arcs in this project." };
    const width = Math.max(...STATES.map((state) => state.length));
    const moving = said.filter(({ state }) => state === "Working" || state === "Landed").length;
    return {
      text: [`${said.length} active ${said.length === 1 ? "arc" : "arcs"}, ${moving} moving:`, ...said.map(({ lane, state, why }) => `  ${state.padEnd(width)}  ${lane.id}  ${lane.title} — ${why}`)].join("\n"),
      next: [{ command: "arc show <arc>", why: "see one whole" }],
    };
  },
});
