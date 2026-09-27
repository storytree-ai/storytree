/** Capability 4's founding book (E1, V1, S1): the core's picture, a pinned note's card, and replay frames. */
import type { Change } from "@storytree/library";

import type { Knowledge } from "../ghosts/ghosts.js";
import type { AgentReplay, Jump, ReadRecord } from "../reads/reads.js";
import type { Core } from "../shelves/shelves.js";

export type SizeBy = "visits" | "links-in";

/** What each size mode counts, as the view labels it. */
export const SIZE_LABELS: Readonly<Record<SizeBy, string>> = {
  visits: "Size: visits, the distinct recorded sessions that reached it",
  "links-in": "Size: links in, the distinct notes linking to it",
};

export interface Point {
  x: number;
  y: number;
  z: number;
}

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
}

export interface CoreScene {
  entrances: Entrance[];
  notes: DrawnNote[];
  sizeLabel: string;
  status: string | undefined;
}

export interface Card {
  id: string;
  title: string;
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

export function coreScene(_input: CoreInput): CoreScene {
  return { entrances: [], notes: [], sizeLabel: "", status: undefined };
}

export function noteCard(_id: string, _input: CoreInput): Card | undefined {
  return undefined;
}

export function pinnedLinks(_id: string | undefined, _knowledge: Knowledge): Link[] {
  return [{ kind: "link", from: "", to: "" }];
}

export function replayFrame(_agents: readonly AgentReplay[], _step: number, _hidden: ReadonlySet<string>): ReplayFrame {
  return { lit: new Map([["", ""]]), jumps: [], steps: 0 };
}

export function legend(_agents: readonly AgentReplay[]): LegendEntry[] {
  return [];
}
