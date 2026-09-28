/** Capability 4's founding book (E1, V1, S1): the core's picture, a pinned note's card, and replay frames. */
import type { Change, RecordEnvelope } from "@storytree/library";

import { linksOf, type Knowledge } from "../ghosts/ghosts.js";
import type { AgentReplay, Jump, ReadRecord } from "../reads/reads.js";
import type { Core } from "../shelves/shelves.js";
import { shelfDirections, shelfPositions, tilt, onSphere, scale, unit, length, type Point } from "../shelves/positions.js";

export type SizeBy = "visits" | "links-in";

/** What each size mode counts, as the view labels it. */
export const SIZE_LABELS: Readonly<Record<SizeBy, string>> = {
  visits: "Size: visits, the distinct recorded sessions that reached it",
  "links-in": "Size: links in, the distinct artifacts linking to it",
};

export type { Point } from "../shelves/positions.js";

export interface CoreInput {
  changes: readonly Change[];
  knowledge: Knowledge;
  core: Core;
  reads: ReadRecord;
  /** Each story's island, as a unit direction from the globe's centre. */
  spots: ReadonlyMap<string, Point>;
  radius: number;
  /** The session selected to compare against and replay. */
  session: string | undefined;
  sizeBy: SizeBy;
  /** The replay's current frame, lighting notes in their agents' colours. */
  frame?: ReplayFrame;
  /** The running sessions the host lists, lit together while no session is selected (ADR-0738). */
  roster?: readonly RosterEntry[];
}

/** One listed running session: its colour, and the session ids (its own and its children's) whose reads wear it. */
export interface RosterEntry {
  session: string;
  label: string;
  colour: string;
  members: readonly string[];
}

export interface Entrance {
  node: string;
  story: string;
  title: string;
  at: Point;
}

export interface DrawnNote {
  id: string;
  title: string;
  at: Point;
  depth: number | undefined;
  ghost: boolean;
  loop: string | undefined;
  size: number;
  /** "lit" in the frame, "reached" by the session, "grey" when the session never reached it. */
  tone: "lit" | "reached" | "grey";
  /** The agent that lit it in the frame. */
  agent: string | undefined;
  /** With no session selected: the colour of the latest listed session to read it. */
  colour: string | undefined;
  /** With no session selected: read by more than one listed session. */
  shared: boolean;
}

export interface CoreScene {
  entrances: Entrance[];
  notes: DrawnNote[];
  sizeLabel: string;
  status: string | undefined;
}

export interface Card {
  id: string;
  kind: string;
  title: string;
  /** The description or the artifact kind's summary field; absent means show its whole text. */
  summary: string | undefined;
  text: string;
  /** The title of the shelf it hangs under. */
  home: string | undefined;
  depth: string;
  entrances: string[];
  replacement: string | undefined;
  visits: number;
  peeks: number;
  wholes: number;
  /** Each replaced decision it links to, with how it was replaced (S1). */
  linksToReplaced: string[];
}

export interface Link {
  kind: "link";
  from: string;
  to: string;
}

export interface ReplayFrame {
  /** Each note lit so far, by the agent that first lit it, in the order they lit. */
  lit: Map<string, string>;
  jumps: (Jump & { agent: string })[];
  /** How many steps the whole replay has. */
  steps: number;
}

export interface LegendEntry {
  agent: string;
  label: string;
  task: string | undefined;
  colour: string;
}

/** The orchestrator's colour, then each subagent's in turn (Okabe-Ito, told apart by colour-blind eyes), and unknown's pale. */
const ORCHESTRATOR = "#0072B2";
const SUBAGENTS = ["#E69F00", "#009E73", "#CC79A7", "#F0E442", "#56B4E9", "#D55E00"];
const UNKNOWN = "#9AA0AA";
/** Lightnesses a listed session's subagents take, skipping the session's own. */
const SHADES = [46, 84, 36, 76, 56, 90, 28];
/** Ghosts sit beside their replacements, in radians. */
const GHOST_OFFSET = 0.035;
/** Notes no shelf reaches orbit outside; ghosts with no placed replacement orbit further out. */
const OUTSIDE = 1.3;
const UNPLACED = 1.45;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * The core's picture. Each shelf is an entrance on its story's island: a story's own shelf at the
 * island's spot, its capabilities' in a ring close around it. A placed note hangs below its home
 * shelf, further in the deeper it is, spread in a small spiral from its siblings. Notes with no
 * depth orbit outside the globe; a ghost sits beside the note that replaced it, or further out
 * when its replacement is not placed. Size never moves a note.
 */
export function coreScene(input: CoreInput): CoreScene {
  const { knowledge, core, reads, radius, session, sizeBy, frame } = input;
  const titles = titlesOf(input.changes);
  const directions = shelfDirections(input);
  const entrances = core.shelves.flatMap(({ node, story }) => {
    const direction = directions.get(node);
    return direction === undefined ? [] : [{ node, story, title: titles.get(node) ?? node, at: scale(direction, radius) }];
  });

  const at = shelfPositions(input);
  core.outside.forEach((id, index) => at.set(id, scale(onSphere(index, core.outside.length), radius * OUTSIDE)));
  const unplaced: string[] = [];
  const beside = new Map<string, number>();
  for (const ghost of [...knowledge.ghosts.values()].sort((a, b) => compare(a.note, b.note))) {
    const next = ghost.beside === undefined ? undefined : at.get(ghost.beside);
    if (ghost.beside === undefined || next === undefined) {
      unplaced.push(ghost.note);
      continue;
    }
    const index = beside.get(ghost.beside) ?? 0;
    beside.set(ghost.beside, index + 1);
    at.set(ghost.note, scale(tilt(unit(next), GHOST_OFFSET * (1 + index * 0.5), index * GOLDEN + Math.PI / 3), length(next)));
  }
  unplaced.forEach((id, index) => at.set(id, scale(onSphere(index, unplaced.length), radius * UNPLACED)));

  const present = new Set(knowledge.notes.keys());
  const reached = new Set(session === undefined ? [] : reads.replay(session, present).agents.flatMap(({ lit }) => lit.map(({ note }) => note)));
  const live = session === undefined ? liveReads(reads, input.roster ?? [], present) : new Map<string, LiveNote>();
  const notes: DrawnNote[] = [...at].map(([id, point]) => {
    const count = sizeBy === "visits" ? reads.visits(id) : knowledge.linksIn.get(id) ?? 0;
    const placement = core.placed.get(id);
    const agent = frame?.lit.get(id);
    const lit = live.get(id);
    return {
      id, title: titleOf(knowledge, id), at: point, depth: placement?.depth, ghost: knowledge.ghosts.has(id), loop: placement?.loop,
      size: 1 + Math.sqrt(count), tone: agent !== undefined || lit !== undefined ? "lit" : reached.has(id) ? "reached" : "grey", agent,
      colour: lit?.colour, shared: (lit?.sessions.size ?? 0) > 1,
    };
  });
  return { entrances, notes, sizeLabel: SIZE_LABELS[sizeBy], status: reads.status() };
}

/** A pinned artifact's shared summary, with inspection metadata retained for the inside view's model. */
export function noteCard(id: string, input: CoreInput): Card | undefined {
  const { knowledge, core, reads } = input;
  const note = knowledge.notes.get(id);
  if (note === undefined) return undefined;
  const titles = titlesOf(input.changes);
  const placement = core.placed.get(id);
  const ghost = knowledge.ghosts.get(id);
  const replaced = [...knowledge.ghosts.values()].filter(({ beside }) => beside === id).map(({ note: old }) => titleOf(knowledge, old));
  const text = firstWords(note.fields.text, note.fields.meaning, note.fields.statement, note.fields.role, note.fields.description);
  return {
    id,
    kind: note.type,
    title: titleOf(knowledge, id),
    summary: firstWords(note.fields.description, note.fields.summary, note.fields.oneLine, note.fields.statement, note.fields.meaning),
    text: text ?? "",
    home: placement === undefined ? undefined : titles.get(placement.home) ?? placement.home,
    depth: placement === undefined ? "no depth" : placement.loop === undefined ? `depth ${placement.depth}` : `depth ${placement.depth}, in a loop (a refused shape)`,
    entrances: placement?.entrances.map((node) => titles.get(node) ?? node) ?? [],
    replacement: ghost?.label ?? (replaced.length === 0 ? undefined : `replaces ${replaced.join(", ")}`),
    visits: reads.visits(id),
    ...reads.totals(id),
    linksToReplaced: linksOf(note).flatMap((target) => {
      const old = knowledge.ghosts.get(target);
      return old === undefined ? [] : [`${titleOf(knowledge, target)}: ${old.label}`];
    }),
  };
}

function firstWords(...fields: unknown[]): string | undefined {
  return fields.find((field): field is string => typeof field === "string" && field.trim() !== "");
}

/** The pinned note's stored links, out and then in, each in its stored direction; none with nothing pinned. */
export function pinnedLinks(id: string | undefined, knowledge: Knowledge): Link[] {
  const note = id === undefined ? undefined : knowledge.notes.get(id);
  if (id === undefined || note === undefined) return [];
  const out = [...new Set(linksOf(note))].filter((to) => to !== id && knowledge.notes.has(to)).map((to): Link => ({ kind: "link", from: id, to }));
  const into = [...knowledge.notes.values()]
    .filter((other) => other.id !== id && linksOf(other).includes(id))
    .map(({ id: from }) => from)
    .sort(compare)
    .map((from): Link => ({ kind: "link", from, to: id }));
  return [...out, ...into];
}

/** The replay after `step` of its steps, one read a step, in recorded order across the visible agents. */
export function replayFrame(agents: readonly AgentReplay[], step: number, hidden: ReadonlySet<string>): ReplayFrame {
  const visible = agents.filter(({ agent }) => !hidden.has(agent));
  const events = visible.flatMap(({ agent, lit }) => lit.map((read) => ({ agent, ...read }))).sort((a, b) => a.seq - b.seq);
  const taken = events.slice(0, Math.max(0, Math.min(step, events.length)));
  const lit = new Map<string, string>();
  for (const { note, agent } of taken) if (!lit.has(note)) lit.set(note, agent);
  const last = taken.at(-1)?.seq ?? -Infinity;
  const jumps = visible.flatMap(({ agent, jumps: moves }) => moves.filter(({ seq }) => seq <= last).map((jump) => ({ ...jump, agent })));
  return { lit, jumps: jumps.sort((a, b) => a.seq - b.seq), steps: events.length };
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

interface LiveNote {
  colour: string;
  seq: number;
  sessions: Set<string>;
}

/** Every listed session's reads since it started, no fade: each note in its latest reader's colour (ADR-0738 D1-D3). */
function liveReads(reads: ReadRecord, roster: readonly RosterEntry[], present: ReadonlySet<string>): Map<string, LiveNote> {
  const live = new Map<string, LiveNote>();
  for (const { session, colour, members } of roster) {
    for (const member of members) {
      for (const { lit } of reads.replay(member, present).agents) {
        for (const { note, seq } of lit) {
          const seen = live.get(note);
          if (seen === undefined) live.set(note, { colour, seq, sessions: new Set([session]) });
          else {
            seen.sessions.add(session);
            if (seq > seen.seq) Object.assign(seen, { colour, seq });
          }
        }
      }
    }
  }
  return live;
}

function titlesOf(changes: readonly Change[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const change of changes) {
    const title = change.record.fields.title;
    if (change.action === "retired") titles.delete(change.recordId);
    else if (typeof title === "string") titles.set(change.recordId, title);
  }
  return titles;
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

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
