/** Capability 4's founding book (E1, V1, S1): a pinned note's card, and how the running sessions' reads light and cross the globe. */
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

/** How an opened file stands on the land: in a selected session's window, or, with none selected, read by a listed session since it started, with no fade (ADR-0738 D1). */
export type CodeState = WindowState | "read";

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

/** A lit note's dot colour, and who read it: each reader's colour, in the order they first reached it, with its latest read. */
export interface Lighting {
  colour: string;
  readers: readonly { colour: string; last: number }[];
}

/** The ring around a note several listed sessions read: one arc per session, in arrival order (ADR-0754 D2); none for one reader. */
export function ringArcs(lighting: Lighting): string[] {
  return lighting.readers.length > 1 ? lighting.readers.map(({ colour }) => colour) : [];
}

/** A note's arc for one reader colour, the key a growing line holds it by (ADR-0754 D2). */
export const arcKey = (note: string, colour: string): string => `${note} ${colour}`;

/**
 * What is drawn now (ADR-0742 D2, ADR-0754 D2): each reader's arc only once its line into the note
 * has arrived (`held` names the arcs still waiting), the dot in the latest arrived reader's colour,
 * and a note none of whose lines has arrived stays unlit.
 */
export function arrived(lit: ReadonlyMap<string, Lighting>, held: ReadonlySet<string>): Map<string, Lighting> {
  if (held.size === 0) return new Map(lit);
  const shown = new Map<string, Lighting>();
  for (const [note, lighting] of lit) {
    const readers = lighting.readers.filter(({ colour }) => !held.has(arcKey(note, colour)));
    if (readers.length === 0) continue;
    const latest = readers.reduce((a, b) => (b.last > a.last ? b : a));
    shown.set(note, { colour: latest.colour, readers });
  }
  return shown;
}

/**
 * Which notes light, and in what colour (ADR-0738, ADR-0754 D2). With no session selected: every
 * listed session's reads since it started, each note in its latest reader's colour, with every
 * session that read it. With one selected: that session's whole reads, each note in the colour of
 * the agent that first read it, a listed session's agents in shades of its colour.
 */
export function lighting(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>, windowed: ReadonlyMap<string, AgentReplay> = new Map()): Map<string, Lighting> {
  if (session === undefined) {
    return new Map([...liveReads(reads, roster, present, windowed)].map(([note, live]) => [note, lightingOf(live)]));
  }
  const { agents } = reads.replay(session, present);
  const colours = new Map(legend(agents, roster.find(({ members }) => members.includes(session))?.colour).map(({ agent, colour }) => [agent, colour]));
  const first = new Map<string, { colour: string; seq: number }>();
  for (const { agent, lit } of agents) {
    for (const { note, seq } of lit) {
      const seen = first.get(note);
      if (seen === undefined || seq < seen.seq) first.set(note, { colour: colours.get(agent)!, seq });
    }
  }
  return new Map([...first].map(([note, { colour, seq }]) => [note, { colour, readers: [{ colour, last: seq }] }]));
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
  /** What a reading path's step crosses when it reaches a file with no session selected (ADR-0804 D5); none between two notes. */
  kind?: "hop" | "dive";
}

/**
 * The reading paths to draw (ADR-0740), in recorded order: every listed session's in its colour
 * with none selected, or the selected session's in its agents' colours. Each is the replay's jumps
 * (a known agent's full reads, one to the next, and in a selected session a subagent's first from
 * where it was spawned); a peek or an unknown agent draws none, and a repeated step of the same
 * session draws once.
 */
export function trails(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>, windowed: ReadonlyMap<string, AgentReplay> = new Map()): Trail[] {
  const drawn = new Map<string, Trail>();
  const agents = drawnAgents(reads, roster, session, present, windowed);
  // In a selected session's replay a subagent's first read steps from the session's latest full read before it,
  // where it was spawned, so the head carries on from there (ADR-0797): a line meaning "read next", never a followed link.
  const wholes = session === undefined ? [] : agents.flatMap(({ replay }) => replay.known ? replay.jumps.map(({ to, seq }) => ({ agent: replay.agent, to, seq })) : []);
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

/** One known agent's reading path (ADR-0742): every step it has taken, in recorded order, and where it ends. */
export interface AgentPath {
  /** The session the reads were filed under and the agent, as "<session> <agent>". */
  mover: string;
  colour: string;
  /** The note it read in full most recently. */
  note: string;
  steps: Trail[];
}

/**
 * The paths to replay (ADR-0742 D3): one per known agent of each drawn session (as `trails` draws
 * them) that has read something in full, ending at its latest full read. A peek adds no step, and
 * an unknown agent or an unlisted session has none.
 */
export function agentPaths(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>, windowed: ReadonlyMap<string, AgentReplay> = new Map()): AgentPath[] {
  return drawnAgents(reads, roster, session, present, windowed).flatMap(({ member, replay, colour }) => {
    const note = replay.lit.filter(({ read }) => read === "whole").at(-1)?.note;
    if (!replay.known || note === undefined) return [];
    const mover = `${member} ${replay.agent}`;
    const steps = replay.jumps.flatMap(({ from, to, seq }): Trail[] => {
      if (from === undefined || from === to) return [];
      const kind = crossing(from, to);
      return [{ from, to, colour, seq, mover, ...(kind === undefined ? {} : { kind }) }];
    });
    return [{ mover, colour, note, steps }];
  });
}

/** Where an agent's looping glow is (ADR-0742 D3): each step takes `step` ms in order, then a `pause`, then again. */
export function glowAt(steps: number, elapsed: number, timing: { step: number; pause: number }): { step: number; t: number } | undefined {
  if (steps === 0) return undefined;
  const at = elapsed % (steps * timing.step + timing.pause);
  if (at >= steps * timing.step) return undefined;
  return { step: Math.floor(at / timing.step), t: (at % timing.step) / timing.step };
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

/** Each agent of each drawn session, with the colour its paths wear (ADR-0740 D2). */
function drawnAgents(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>, windowed: ReadonlyMap<string, AgentReplay>): { listed: string; member: string; replay: AgentReplay; colour: string }[] {
  if (session === undefined) {
    return roster.flatMap(({ session: listed, colour, members }) =>
      members.flatMap((member) => memberAgents(reads, member, present, windowed).map((replay) => ({ listed, member, replay, colour }))));
  }
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

/** How far a glow's tail reaches back along its step, as a fraction of the step (ADR-0742 D3). */
const TAIL = 0.35;

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

/** The part of a step's curve a glow with its head at `t` lights: from up to TAIL back, to the head. */
export function tailSpan(t: number): [number, number] {
  return [Math.max(0, t - TAIL), t];
}

interface LiveNote {
  colour: string;
  seq: number;
  /** Each listed session that read it, in the order it first did, with its colour and latest read. */
  readers: Map<string, { colour: string; first: number; last: number }>;
}

/** Every listed session's reads since it started, no fade: each note in its latest reader's colour, with all its readers (ADR-0738 D1-D2, ADR-0754 D2). */
function liveReads(reads: ReadRecord, roster: readonly RosterEntry[], present: ReadonlySet<string>,
  windowed: ReadonlyMap<string, AgentReplay>): Map<string, LiveNote> {
  const live = new Map<string, LiveNote>();
  for (const { session, colour, members } of roster) {
    for (const member of members) {
      for (const { lit } of memberAgents(reads, member, present, windowed)) {
        for (const { note, seq } of lit) {
          const seen = live.get(note) ?? live.set(note, { colour, seq, readers: new Map() }).get(note)!;
          if (seq > seen.seq) Object.assign(seen, { colour, seq });
          const reader = seen.readers.get(session);
          if (reader === undefined) seen.readers.set(session, { colour, first: seq, last: seq });
          else Object.assign(reader, { first: Math.min(reader.first, seq), last: Math.max(reader.last, seq) });
        }
      }
    }
  }
  // A session's members are read one after another, so arrival order is sorted in at the end.
  for (const seen of live.values()) seen.readers = new Map([...seen.readers].sort(([, a], [, b]) => a.first - b.first));
  return live;
}

/**
 * A listed member's agents with no session selected: its window's reads when it has a window, with
 * its log's subagents beside them (a subagent's transcript is its own), else its log's alone.
 */
function memberAgents(reads: ReadRecord, member: string, present: ReadonlySet<string>, windowed: ReadonlyMap<string, AgentReplay>): AgentReplay[] {
  const { agents } = reads.replay(member, present);
  const window = windowed.get(member);
  return window === undefined ? agents : [window, ...agents.filter(({ agent }) => agent.startsWith("subagent:"))];
}

function lightingOf({ colour, readers }: LiveNote): Lighting {
  return { colour, readers: [...readers.values()].map(({ colour: reader, last }) => ({ colour: reader, last })) };
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

/**
 * Every listed session's window as the no-selection view reads it (ADR-0754 D1): the notes it
 * opened, in reading order, as one known agent's full reads, each a step from the stop before. With
 * the code's `places`, each surveyed file it opened is a stop too, on its circle (ADR-0804 D5), which
 * lights on the land rather than in the core; without them files are stepped over. Glimpses are not
 * drawn here, and a compacted read still lights, since this view shows a session's reads since it
 * started with no fade (ADR-0738 D1). A session with no window has none, so its log's reads stand
 * in. `stamps` give each open its place in time (see stampOpens); an unstamped open is history.
 */
export function windowReplays(windows: ReadonlyMap<string, SessionWindow>, present: ReadonlySet<string>,
  stamps: ReadonlyMap<string, readonly number[]> = new Map(), places?: CodePlaces): Map<string, AgentReplay> {
  const replays = new Map<string, AgentReplay>();
  for (const [session, window] of windows) {
    if ("absent" in window) continue;
    const replay: AgentReplay = { agent: "orchestrator", label: "orchestrator", known: true, lit: [], jumps: [] };
    window.opens.forEach((open, index) => {
      const seq = stamps.get(session)?.[index] ?? 0;
      const key = open.kind === "file" ? surveyed(open.id, places) : undefined;
      if (key !== undefined) {
        replay.jumps.push({ from: replay.jumps.at(-1)?.to, to: fileStop(key), move: "jump", seq, at: window.at });
        return;
      }
      if (open.kind !== "note" || !present.has(open.id)) return;
      replay.lit.push({ note: open.id, read: "whole", seq, at: window.at });
      replay.jumps.push({ from: replay.jumps.at(-1)?.to, to: open.id, move: "jump", seq, at: window.at });
    });
    replays.set(session, replay);
  }
  return replays;
}

/** The surveyed file a path names, when the code's places have its circle. */
function surveyed(path: string, places: CodePlaces | undefined): string | undefined {
  const key = places === undefined ? undefined : codeKey(path);
  return key !== undefined && places!.files.has(key) ? key : undefined;
}

/**
 * The files every listed session's window has opened, as the no-selection view lights them on the land
 * (ADR-0804 D5, ADR-0738 D1): each read since the session started, with no fade, in the colour of the
 * session that read it latest by `stamps`, a later open winning a tie.
 */
export function rosterCode(windows: ReadonlyMap<string, SessionWindow>, roster: readonly RosterEntry[], places: CodePlaces,
  stamps: ReadonlyMap<string, readonly number[]> = new Map()): { files: Map<string, CodeState>; colours: Map<string, string> } {
  const latest = new Map<string, { colour: string; seq: number }>();
  for (const { colour, members } of roster) {
    for (const member of members) {
      const window = windows.get(member);
      if (window === undefined || "absent" in window) continue;
      window.opens.forEach((open, index) => {
        const key = open.kind === "file" ? surveyed(open.id, places) : undefined;
        if (key === undefined) return;
        const seq = stamps.get(member)?.[index] ?? 0;
        const seen = latest.get(key);
        if (seen === undefined || seq >= seen.seq) latest.set(key, { colour, seq });
      });
    }
  }
  return {
    files: new Map([...latest.keys()].map((key) => [key, "read" as const])),
    colours: new Map([...latest].map(([key, { colour }]) => [key, colour])),
  };
}

/**
 * When each of a session's `count` opens was first seen (ADR-0742 D4): every open in its first
 * window reading is history (0), and each open a later reading adds is stamped after `clock`, the
 * latest line or open already seen, so its step grows while history never does.
 */
export function stampOpens(previous: readonly number[] | undefined, count: number, clock: number): { stamps: number[]; clock: number } {
  if (previous === undefined) return { stamps: Array.from({ length: count }, () => 0), clock };
  const stamps = previous.slice(0, count);
  while (stamps.length < count) stamps.push(++clock);
  return { stamps, clock };
}
