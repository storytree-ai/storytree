/** Capability 4 · Look inside and inspect an artifact. Capability 4's founding book (E1, V1, S1): a pinned note's card, and how the running sessions' reads light and cross the globe. */
import type { SessionWindow } from "@storytree/agent-link";
import type { RecordEnvelope } from "@storytree/library";

import type { Knowledge } from "../ghosts/ghosts.js";
import type { AgentReplay, ReadRecord } from "../reads/reads.js";
import { unit, length, type Point } from "../shelves/positions.js";

export type { Point } from "../shelves/positions.js";

export interface RosterEntry {
  session: string;
  label: string;
  colour: string;
  members: readonly string[];
}

export interface Card {
  id: string;
  kind: string;
  title: string;
  /** The description or the artifact kind's summary field; absent means show its whole text. */
  summary: string | undefined;
  text: string;
}

export interface LegendEntry {
  agent: string;
  label: string;
  task: string | undefined;
  colour: string;
}

/** The orchestrator's colour, then each subagent's in turn (Okabe-Ito, told apart by colour-blind eyes), and unknown's pale. */
export const ORCHESTRATOR = "#0072B2";
const SUBAGENTS = ["#E69F00", "#009E73", "#CC79A7", "#F0E442", "#56B4E9", "#D55E00"];
const UNKNOWN = "#9AA0AA";
/** Lightnesses a listed session's subagents take, skipping the session's own. */
const SHADES = [46, 84, 36, 76, 56, 90, 28];
/** A pinned note's summary card: its kind, title, and description or another summary field, else its whole text. */
export function noteCard(id: string, knowledge: Knowledge): Card | undefined {
  const note = knowledge.notes.get(id);
  if (note === undefined) return undefined;
  const text = firstWords(note.fields.text, note.fields.meaning, note.fields.statement, note.fields.role, note.fields.description);
  return {
    id,
    kind: note.type,
    title: titleOf(knowledge, id),
    summary: firstWords(note.fields.description, note.fields.summary, note.fields.oneLine, note.fields.statement, note.fields.meaning),
    text: text ?? "",
  };
}

function firstWords(...fields: unknown[]): string | undefined {
  return fields.find((field): field is string => typeof field === "string" && field.trim() !== "");
}

/** One step of a selected session's traversal: from one opened note to the next it opened (ADR-0756). */
export interface TraversalStep {
  from: string;
  to: string;
  /** Solid where a stored link joins the two notes, either way round; dotted where none does, a jump by search or another route. */
  edge: "solid" | "dotted";
  /** Either end's read has left the window since, so the step fades with it. */
  faded: boolean;
  /** What a step across the code's surface is (ADR-0804 D5): a hop between two files, or a dive between a file and a note; a step between two notes has none. */
  kind?: "hop" | "dive";
}

/** How an opened file or capability stands in a selected session's window: read in it now, or compacted out since. */
export type WindowState = "in-window" | "faded";

/**
 * The code's surface as the forest lays it on the globe (ADR-0804 D5), handed to the core so its traversal
 * can reach it. Files are keyed by `packages/<package>/<path in the package>`, as `codeKey` names them.
 */
export interface CodePlaces {
  /** Each surveyed file's circle: where it lies, in the globe's coordinates. */
  files: ReadonlyMap<string, Point>;
  /** Which surveyed file imports which, by the same keys. */
  imports: readonly { from: string; to: string }[];
  /** The capabilities that have a territory. */
  capabilities: ReadonlySet<string>;
}

/** A surveyed file's key: its package and its path in the package. */
export function codePathKey(pkg: string, path: string): string {
  return `packages/${pkg}/${path}`;
}

/** The surveyed file a path a session opened names, by `packages/<package>/src/…`: whatever came before it does not matter. Undefined when it names none. */
export function codeKey(path: string): string | undefined {
  const match = /(?:^|\/)packages\/([^/]+)\/(src\/.+)$/.exec(path.replaceAll("\\", "/"));
  return match === null ? undefined : codePathKey(match[1]!, match[2]!);
}

/** A file's stop in a traversal: its key, told apart from every note's id. */
export const fileStop = (key: string): string => `file:${key}`;

/** What a step from one stop to the next crosses (ADR-0804 D5): a hop between two files, a dive between a file and a note, nothing between two notes. */
function crossing(from: string, to: string): "hop" | "dive" | undefined {
  const [a, b] = [from.startsWith("file:"), to.startsWith("file:")];
  return a && b ? "hop" : a || b ? "dive" : undefined;
}

/** The window's colour (ADR-0746 D1): a warm white no session wears, since sessions take their colours from the whole hue wheel. */
export const IN_VIEW = "#f4ecd8";

/** What a selected session's window shows in the core (ADR-0756). */
export interface WindowView {
  /** Present notes opened in full whose read is in the window now: a ring, in full colour. */
  notes: Set<string>;
  /** Present notes opened in full whose read has since been compacted out: a lighter dot. */
  faded: Set<string>;
  /** Present notes named in a result in the window but never opened: a faint tint, no line. */
  glimpsed: Set<string>;
  /** Files whose opened read is in the window now, in the order opened, by the path the call named. */
  files: string[];
  /** The surveyed files and territories the session opened, by their keys: lit on the land, in the window or compacted out. */
  code: { files: Map<string, WindowState>; capabilities: Map<string, WindowState> };
  /** One step per move between opened notes, in reading order; a step taken again draws once. */
  steps: TraversalStep[];
  /** Why there is no window to show, when there is none. */
  status: string | undefined;
}

/**
 * A session's window as the core draws it (4.16, ADR-0756): the notes it opened, in reading order,
 * each step joined by a line; files read between them do not break the chain, and a note no longer
 * in the library is stepped over. `joined` says whether a stored link joins two notes.
 */
export function windowView(window: SessionWindow, present: ReadonlySet<string>, joined: (a: string, b: string) => boolean, places?: CodePlaces): WindowView {
  const view: WindowView = { notes: new Set(), faded: new Set(), glimpsed: new Set(), files: [], steps: [], code: { files: new Map(), capabilities: new Map() }, status: undefined };
  if ("absent" in window) return { ...view, status: `No window: ${window.absent}` };
  const opened: string[] = [];
  /** Every stop in reading order: a present note by its id, a surveyed file by its stop. */
  const stops: string[] = [];
  const imported = new Set((places?.imports ?? []).flatMap(({ from, to }) => [`${from}>${to}`, `${to}>${from}`]));
  // A read is in the window if any open of it is: read again since a compaction, it is in the window now.
  const stateOf = (open: { resident: boolean }, before: WindowState | undefined): WindowState => open.resident || before === "in-window" ? "in-window" : "faded";
  for (const open of window.opens) {
    if (open.kind === "file") {
      if (open.resident && !view.files.includes(open.id)) view.files.push(open.id);
      const key = places === undefined ? undefined : codeKey(open.id);
      if (key === undefined || !places!.files.has(key)) continue;
      view.code.files.set(key, stateOf(open, view.code.files.get(key)));
      stops.push(fileStop(key));
    } else if (present.has(open.id)) {
      opened.push(open.id);
      stops.push(open.id);
      if (open.resident) view.notes.add(open.id);
    } else if (places?.capabilities.has(open.id)) {
      view.code.capabilities.set(open.id, stateOf(open, view.code.capabilities.get(open.id)));
    }
  }
  for (const note of opened) if (!view.notes.has(note)) view.faded.add(note);
  for (const note of window.glimpses) if (present.has(note) && !opened.includes(note)) view.glimpsed.add(note);
  const isFile = (stop: string): boolean => stop.startsWith("file:");
  const fadedStop = (stop: string): boolean => isFile(stop) ? view.code.files.get(stop.slice("file:".length)) === "faded" : view.faded.has(stop);
  const taken = new Set<string>();
  stops.forEach((to, index) => {
    const from = stops[index - 1];
    if (from === undefined || from === to || taken.has(`${from}>${to}`)) return;
    taken.add(`${from}>${to}`);
    const faded = fadedStop(from) || fadedStop(to);
    if (isFile(from) && isFile(to)) view.steps.push({ from, to, edge: imported.has(`${from.slice(5)}>${to.slice(5)}`) ? "solid" : "dotted", faded, kind: "hop" });
    else if (isFile(from) || isFile(to)) view.steps.push({ from, to, edge: "dotted", faded, kind: "dive" });
    else view.steps.push({ from, to, edge: joined(from, to) ? "solid" : "dotted", faded });
  });
  return view;
}

/** A selected session's traversal steps as the trails the globe draws, one per step in reading order, in the session's colour. */
export function traversalTrails(steps: readonly TraversalStep[], colour: string, mover: string): Trail[] {
  return steps.map(({ from, to, edge, faded, kind }, seq): Trail => ({ from, to, colour, seq, mover, step: kind === undefined ? { edge, faded } : { edge, faded, kind } }));
}

/** How far a step's faint fill has run from its earlier note (ADR-0756): 0 to 1 over `run` ms, nothing for a `pause`, then again. */
export function fillAt(elapsed: number, timing: { run: number; pause: number }): number | undefined {
  const at = elapsed % (timing.run + timing.pause);
  return at < timing.run ? at / timing.run : undefined;
}

/**
 * The legend: the orchestrator, each subagent as the harness named it, then unknown, each its own
 * colour. A listed session's `colour` (an hsl) is the orchestrator's, and its subagents wear shades
 * of that hue (ADR-0738 D5); otherwise the fixed palette.
 */
export function legend(agents: readonly AgentReplay[], colour?: string): LegendEntry[] {
  const rank = (agent: string) => (agent === "orchestrator" ? 0 : agent === "unknown" ? 2 : 1);
  const hsl = colour === undefined ? undefined : /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(colour);
  const subagent = (index: number): string => {
    if (hsl === null || hsl === undefined) return SUBAGENTS[index % SUBAGENTS.length]!;
    const lightness = SHADES.filter((shade) => shade !== Number(hsl[3]))[index % (SHADES.length - 1)]!;
    return `hsl(${hsl[1]}, ${hsl[2]}%, ${lightness}%)`;
  };
  let next = 0;
  return [...agents]
    .sort((a, b) => rank(a.agent) - rank(b.agent))
    .map(({ agent, label, task }) => ({
      agent, label, task,
      colour: agent === "orchestrator" ? (hsl ? colour! : ORCHESTRATOR) : agent === "unknown" ? UNKNOWN : subagent(next++),
    }));
}

/** A lit note's dot colour: the selected session's agent that first read it. */
export interface Lighting {
  colour: string;
}

/**
 * Which notes light, and in what colour (ADR-0738 D5). With no session selected, none: a session's
 * traversal shows only while it is selected (ADR-0921). With one selected: that session's whole reads,
 * each note in the colour of the agent that first read it, a listed session's agents in shades of its colour.
 */
export function lighting(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>): Map<string, Lighting> {
  if (session === undefined) return new Map();
  const { agents } = reads.replay(session, present);
  const colours = new Map(legend(agents, roster.find(({ members }) => members.includes(session))?.colour).map(({ agent, colour }) => [agent, colour]));
  const first = new Map<string, { colour: string; seq: number }>();
  for (const { agent, lit } of agents) {
    for (const { note, seq } of lit) {
      const seen = first.get(note);
      if (seen === undefined || seq < seen.seq) first.set(note, { colour: colours.get(agent)!, seq });
    }
  }
  return new Map([...first].map(([note, { colour }]) => [note, { colour }]));
}

/** A knowledge dot's radius, as a fraction of the globe's: an unread note's, and the most-read note's (ADR-0926 D2). */
export const DOT_FLOOR = 0.006;
export const DOT_CEILING = 0.012;

/**
 * Each drawn note's dot size from its reach (ADR-0926 D2): the floor for a note no session read, the
 * ceiling for the most-read drawn note, and between them the area above the floor's grows linearly
 * with reach, so the radius grows with its square root. Nothing a session lights changes it (D3).
 */
export function dotSizes(reach: ReadonlyMap<string, number>, notes: Iterable<string>): Map<string, number> {
  const drawn = [...notes];
  const top = Math.max(0, ...drawn.map(note => reach.get(note) ?? 0));
  return new Map(drawn.map(note => [note, top === 0 ? DOT_FLOOR
    : Math.sqrt(DOT_FLOOR ** 2 + (DOT_CEILING ** 2 - DOT_FLOOR ** 2) * (reach.get(note) ?? 0) / top)]));
}

/** One step of a session's reading path: from a full read to the same agent's next, never a followed link (ADR-0740). */
export interface Trail {
  from: string;
  to: string;
  colour: string;
  seq: number;
  /** The session the reads were filed under and the agent that read, as "<session> <agent>". */
  mover: string;
  /** A selected session's traversal step (ADR-0756): solid or dotted, and whether it fades; a reading path's curve has none. */
  step?: Pick<TraversalStep, "edge" | "faded" | "kind">;
  /** What a reading path's step crosses when it reaches a file (ADR-0804 D5); none between two notes. */
  kind?: "hop" | "dive";
}

/**
 * The reading paths to draw (ADR-0740), in recorded order: the selected session's in its agents'
 * colours, and none with none selected (ADR-0921). Each is the replay's jumps (a known agent's full
 * reads, one to the next, and a subagent's first from where it was spawned); a peek or an unknown
 * agent draws none, and a repeated step draws once.
 */
export function trails(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>): Trail[] {
  if (session === undefined) return [];
  const drawn = new Map<string, Trail>();
  const agents = drawnAgents(reads, roster, session, present);
  // In a selected session's replay a subagent's first read steps from the session's latest full read before it,
  // where it was spawned, so the head carries on from there (ADR-0797): a line meaning "read next", never a followed link.
  const wholes = agents.flatMap(({ replay }) => replay.known ? replay.jumps.map(({ to, seq }) => ({ agent: replay.agent, to, seq })) : []);
  const spawnedFrom = (agent: string, seq: number): string | undefined =>
    wholes.filter((whole) => whole.agent !== agent && whole.seq < seq).sort((a, b) => a.seq - b.seq).at(-1)?.to;
  for (const { listed, member, replay, colour } of agents) {
    for (const jump of replay.jumps) {
      const { to, seq } = jump;
      const from = jump.from ?? (replay.agent.startsWith("subagent:") ? spawnedFrom(replay.agent, seq) : undefined);
      if (from === undefined || from === to || drawn.has(`${listed} ${from} ${to}`)) continue;
      const kind = crossing(from, to);
      drawn.set(`${listed} ${from} ${to}`, { from, to, colour, seq, mover: `${member} ${replay.agent}`, ...(kind === undefined ? {} : { kind }) });
    }
  }
  return [...drawn.values()].sort((a, b) => a.seq - b.seq);
}

/** Where a selected session's replay is, `elapsed` ms into it (ADR-0797). */
export interface ReplayMoment<S> {
  /** Steps the head has passed, drawn whole, in the order it walked them. */
  drawn: S[];
  /** The step whose line is growing, `t` of the way along; none while the finished picture holds. */
  head: { step: S; t: number } | undefined;
  /** The notes reached so far: both ends of each drawn step, and where the head set out from. */
  lit: Set<string>;
  /** The picture has held for its rest: start again from nothing. */
  over: boolean;
}

/**
 * A selected session's replay (ADR-0797 D1): one head walks every step of all its agents in
 * recorded order (seq), `step` ms each, growing each line and lighting each note as it arrives;
 * the finished picture holds for `rest`, then the replay is over. A step recorded meanwhile joins
 * the end, since the order is by seq.
 */
export function replayAt<S extends { from: string; to: string; seq: number }>(steps: readonly S[], elapsed: number,
  timing: { step: number; rest: number }): ReplayMoment<S> {
  const order = [...steps].sort((a, b) => a.seq - b.seq);
  const index = Math.max(0, Math.floor(elapsed / timing.step));
  const drawn = order.slice(0, index);
  const next = order[index];
  const head = next === undefined ? undefined : { step: next, t: (elapsed - index * timing.step) / timing.step };
  const lit = new Set(drawn.flatMap(({ from, to }) => [from, to]));
  if (head !== undefined) lit.add(head.step.from);
  return { drawn, head, lit, over: order.length === 0 || elapsed >= order.length * timing.step + timing.rest };
}

/**
 * When each new step starts growing (ADR-0742 D2): one agent's steps one after another in recorded
 * order, each waiting for that agent's step already growing; different agents at once.
 */
export function growthPlan(fresh: readonly { key: string; mover: string; seq: number }[], busy: ReadonlyMap<string, number>, now: number,
  grow: number): { starts: Map<string, number>; busy: Map<string, number> } {
  const starts = new Map<string, number>();
  const next = new Map(busy);
  for (const { key, mover } of [...fresh].sort((a, b) => a.seq - b.seq)) {
    const start = Math.max(now, next.get(mover) ?? now);
    starts.set(key, start);
    next.set(mover, start + grow);
  }
  return { starts, busy: next };
}

/** Each agent of the selected session, with the colour its paths wear (ADR-0740 D2). */
function drawnAgents(reads: ReadRecord, roster: readonly RosterEntry[], session: string,
  present: ReadonlySet<string>): { listed: string; member: string; replay: AgentReplay; colour: string }[] {
  const { agents } = reads.replay(session, present);
  const colours = new Map(legend(agents, roster.find(({ members }) => members.includes(session))?.colour).map(({ agent, colour }) => [agent, colour]));
  return agents.map((replay) => ({ listed: session, member: session, replay, colour: colours.get(replay.agent)! }));
}

/**
 * The notes to keep unlit for now (ADR-0742 D2): each one a step's growing line (or one queued to
 * grow) has not reached yet. A note already shown lit, or reached only by history, is never held.
 */
export function heldNotes(steps: readonly { to: string; key: string }[], starts: ReadonlyMap<string, number>, now: number,
  grow: number, shown: ReadonlySet<string>): Set<string> {
  const held = new Set<string>();
  for (const { to, key } of steps) {
    const start = starts.get(key);
    if (start !== undefined && start + grow > now && !shown.has(to)) held.add(to);
  }
  return held;
}

/** A point `t` of the way along a step's curve: a quadratic Bezier bowed away from the globe's centre (ADR-0740 D3). */
export function curvePoint(from: Point, to: Point, t: number): Point {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  const out = length(middle) === 0 ? { x: 0, y: 1, z: 0 } : unit(middle);
  const bow = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) * 0.3;
  const control = { x: middle.x + out.x * bow, y: middle.y + out.y * bow, z: middle.z + out.z * bow };
  const a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
  return { x: from.x * a + control.x * b + to.x * c, y: from.y * a + control.y * b + to.y * c, z: from.z * a + control.z * b + to.z * c };
}

/**
 * A point `t` of the way along a hop between two files (ADR-0804 D5): the great-circle arc between their circles,
 * lifted off the surface by up to a fifth of the way across, and never more than 12% of the radius, so it arcs
 * just above the land it crosses, however far the second island is. It leaves and lands on the circles themselves.
 */
export function hopPoint(from: Point, to: Point, t: number): Point {
  const [a, b] = [length(from), length(to)];
  const [ua, ub] = [unit(from), unit(to)];
  const angle = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z)));
  const [wa, wb] = angle < 1e-9 ? [1, 0] : [Math.sin((1 - t) * angle) / Math.sin(angle), Math.sin(t * angle) / Math.sin(angle)];
  const lift = Math.min(0.2 * Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), 0.12 * Math.max(a, b)) * Math.sin(Math.PI * t);
  const radius = a + (b - a) * t + lift;
  return { x: (ua.x * wa + ub.x * wb) * radius, y: (ua.y * wa + ub.y * wb) * radius, z: (ua.z * wa + ub.z * wb) * radius };
}

/** The point `t` of the way along a step's curve: a hop between two files stays above the surface, every other step bows outward (ADR-0740 D3). */
export function stepPoint(kind: TraversalStep["kind"], from: Point, to: Point, t: number): Point {
  return kind === "hop" ? hopPoint(from, to, t) : curvePoint(from, to, t);
}

/**
 * A note's name: its title, a definition's term, or else the first line of its words (a memory has
 * no title field), shortened; its id only when it has none of these.
 */
export function noteTitle(record: RecordEnvelope): string {
  const { title, term, text, statement, meaning } = record.fields;
  if (typeof title === "string") return title;
  if (typeof term === "string") return term;
  const words = [text, statement, meaning].find((field): field is string => typeof field === "string" && field.trim() !== "");
  const line = words?.trim().split("\n")[0]!.trim();
  if (line === undefined) return record.id;
  return line.length <= 80 ? line : `${line.slice(0, 79).trimEnd()}…`;
}

function titleOf(knowledge: Knowledge, id: string): string {
  const note = knowledge.notes.get(id);
  return note === undefined ? id : noteTitle(note);
}
