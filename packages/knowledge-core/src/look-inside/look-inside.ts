// Capability 4 · Look inside and inspect an artifact
import type { RecordEnvelope } from "@storytree/library";

import type { Knowledge } from "../ghosts/ghosts.js";
import type { AgentReplay, ReadRecord } from "../reads/reads.js";
import { unit, length, type Point } from "../shelves/positions.js";

export type { Point } from "../shelves/positions.js";

export type SessionWindow = { readonly absent: string } | {
  readonly opens: readonly { readonly kind: "note" | "file"; readonly id: string; readonly resident: boolean }[];
  readonly glimpses: readonly string[];
};

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
  summary: string | undefined;
  text: string;
  fromFactory?: true;
}

export interface LegendEntry {
  agent: string;
  label: string;
  task: string | undefined;
  colour: string;
}

export const ORCHESTRATOR = "#0072B2";
const SUBAGENTS = ["#E69F00", "#009E73", "#CC79A7", "#F0E442", "#56B4E9", "#D55E00"];
const UNKNOWN = "#9AA0AA";
const SHADES = [46, 84, 36, 76, 56, 90, 28];
export function noteCard(id: string, knowledge: Knowledge, fromFactory: ReadonlySet<string> = new Set()): Card | undefined {
  const note = knowledge.notes.get(id);
  if (note === undefined) return undefined;
  const text = firstWords(note.fields.text, note.fields.meaning, note.fields.statement, note.fields.role, note.fields.description);
  return {
    id,
    kind: note.type,
    title: titleOf(knowledge, id),
    summary: firstWords(note.fields.description, note.fields.summary, note.fields.oneLine, note.fields.statement, note.fields.meaning),
    text: text ?? "",
    ...(fromFactory.has(id) ? { fromFactory: true as const } : {}),
  };
}

function firstWords(...fields: unknown[]): string | undefined {
  return fields.find((field): field is string => typeof field === "string" && field.trim() !== "");
}

export interface TraversalStep {
  from: string;
  to: string;
  edge: "solid" | "dotted";
  faded: boolean;
}

export type WindowState = "in-window" | "faded";

export interface CodePlaces {
  capabilities: ReadonlySet<string>;
}

export const IN_VIEW = "#f4ecd8";

export interface WindowView {
  notes: Set<string>;
  faded: Set<string>;
  glimpsed: Set<string>;
  files: string[];
  code: { capabilities: Map<string, WindowState> };
  steps: TraversalStep[];
  status: string | undefined;
}

export function windowView(window: SessionWindow, present: ReadonlySet<string>, joined: (a: string, b: string) => boolean, places?: CodePlaces): WindowView {
  const view: WindowView = { notes: new Set(), faded: new Set(), glimpsed: new Set(), files: [], steps: [], code: { capabilities: new Map() }, status: undefined };
  if ("absent" in window) return { ...view, status: `No window: ${window.absent}` };
  const opened: string[] = [];
  const stateOf = (open: { resident: boolean }, before: WindowState | undefined): WindowState => open.resident || before === "in-window" ? "in-window" : "faded";
  for (const open of window.opens) {
    if (open.kind === "file") {
      if (open.resident && !view.files.includes(open.id)) view.files.push(open.id);
    } else if (present.has(open.id)) {
      opened.push(open.id);
      if (open.resident) view.notes.add(open.id);
    } else if (places?.capabilities.has(open.id)) {
      view.code.capabilities.set(open.id, stateOf(open, view.code.capabilities.get(open.id)));
    }
  }
  for (const note of opened) if (!view.notes.has(note)) view.faded.add(note);
  for (const note of window.glimpses) if (present.has(note) && !opened.includes(note)) view.glimpsed.add(note);
  const taken = new Set<string>();
  opened.forEach((to, index) => {
    const from = opened[index - 1];
    if (from === undefined || from === to || taken.has(`${from}>${to}`)) return;
    taken.add(`${from}>${to}`);
    view.steps.push({ from, to, edge: joined(from, to) ? "solid" : "dotted", faded: view.faded.has(from) || view.faded.has(to) });
  });
  return view;
}

export function traversalTrails(steps: readonly TraversalStep[], colour: string, mover: string): Trail[] {
  return steps.map(({ from, to, edge, faded }, seq): Trail => ({ from, to, colour, seq, mover, step: { edge, faded } }));
}

export function fillAt(elapsed: number, timing: { run: number; pause: number }): number | undefined {
  const at = elapsed % (timing.run + timing.pause);
  return at < timing.run ? at / timing.run : undefined;
}

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

export interface Lighting {
  colour: string;
}

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

export const DOT_FLOOR = 0.006;
export const DOT_CEILING = 0.012;

export function dotSizes(reach: ReadonlyMap<string, number>, notes: Iterable<string>): Map<string, number> {
  const drawn = [...notes];
  const top = Math.max(0, ...drawn.map(note => reach.get(note) ?? 0));
  return new Map(drawn.map(note => [note, top === 0 ? DOT_FLOOR
    : Math.sqrt(DOT_FLOOR ** 2 + (DOT_CEILING ** 2 - DOT_FLOOR ** 2) * (reach.get(note) ?? 0) / top)]));
}

export interface Trail {
  from: string;
  to: string;
  colour: string;
  seq: number;
  mover: string;
  step?: Pick<TraversalStep, "edge" | "faded">;
}

export function trails(reads: ReadRecord, roster: readonly RosterEntry[], session: string | undefined,
  present: ReadonlySet<string>): Trail[] {
  if (session === undefined) return [];
  const drawn = new Map<string, Trail>();
  const agents = drawnAgents(reads, roster, session, present);
  const wholes = agents.flatMap(({ replay }) => replay.known ? replay.jumps.map(({ to, seq }) => ({ agent: replay.agent, to, seq })) : []);
  const spawnedFrom = (agent: string, seq: number): string | undefined =>
    wholes.filter((whole) => whole.agent !== agent && whole.seq < seq).sort((a, b) => a.seq - b.seq).at(-1)?.to;
  for (const { listed, member, replay, colour } of agents) {
    for (const jump of replay.jumps) {
      const { to, seq } = jump;
      const from = jump.from ?? (replay.agent.startsWith("subagent:") ? spawnedFrom(replay.agent, seq) : undefined);
      if (from === undefined || from === to || drawn.has(`${listed} ${from} ${to}`)) continue;
      drawn.set(`${listed} ${from} ${to}`, { from, to, colour, seq, mover: `${member} ${replay.agent}` });
    }
  }
  return [...drawn.values()].sort((a, b) => a.seq - b.seq);
}

export interface ReplayMoment<S> {
  drawn: S[];
  head: { step: S; t: number } | undefined;
  lit: Set<string>;
  over: boolean;
}

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

function drawnAgents(reads: ReadRecord, roster: readonly RosterEntry[], session: string,
  present: ReadonlySet<string>): { listed: string; member: string; replay: AgentReplay; colour: string }[] {
  const { agents } = reads.replay(session, present);
  const colours = new Map(legend(agents, roster.find(({ members }) => members.includes(session))?.colour).map(({ agent, colour }) => [agent, colour]));
  return agents.map((replay) => ({ listed: session, member: session, replay, colour: colours.get(replay.agent)! }));
}

export function heldNotes(steps: readonly { to: string; key: string }[], starts: ReadonlyMap<string, number>, now: number,
  grow: number, shown: ReadonlySet<string>): Set<string> {
  const held = new Set<string>();
  for (const { to, key } of steps) {
    const start = starts.get(key);
    if (start !== undefined && start + grow > now && !shown.has(to)) held.add(to);
  }
  return held;
}

export function curvePoint(from: Point, to: Point, t: number): Point {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  const out = length(middle) === 0 ? { x: 0, y: 1, z: 0 } : unit(middle);
  const bow = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) * 0.3;
  const control = { x: middle.x + out.x * bow, y: middle.y + out.y * bow, z: middle.z + out.z * bow };
  const a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
  return { x: from.x * a + control.x * b + to.x * c, y: from.y * a + control.y * b + to.y * c, z: from.z * a + control.z * b + to.z * c };
}

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
