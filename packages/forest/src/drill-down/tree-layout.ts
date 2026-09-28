/**
 * Capability 4 · Drill-down (the forest story): the capability tree laid out for its own pannable
 * space (ADR-0743). Ported from 0.2's sub-DAG (`layoutSubdag` in its studio): a graph layout
 * (dagre, bottom to top), so what a capability builds on sits below it and another story's
 * capability sits beside the one that builds on it, not in one row of every outside capability.
 * Every card is one readable size: the space pans and zooms, it never shrinks the cards to fit.
 */
import dagre from "@dagrejs/dagre";

import type { CapabilityStatus, HealthState } from "@storytree/library";

import type { StoryPanel } from "./drill-down.js";

/** A card's size, and the height of the status strip across its top. */
export const CARD = { width: 208, height: 94, strip: 18 } as const;
/** Another story's card: context only, so smaller, with no health marks (ADR-0659 D3). */
export const OUTSIDE_CARD = { width: 164, height: 62, strip: 16 } as const;

/** One card of the tree, placed: x and y are its top-left corner. */
export interface Card {
  id: string;
  title: string;
  /** Whether it is one of the story's own capabilities; another story's is context only (ADR-0659 D3). */
  own: boolean;
  /** The title of its story, when it is another story's. */
  story?: string;
  /** Its word, which its strip says (ADR-0744). */
  status: CapabilityStatus;
  /** The agent's report and storytree's own column, for the story's own (storytree's only where written). */
  reported?: HealthState;
  verified?: HealthState;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An arrow from a capability to one it builds on, as an SVG path ending at the one built on. */
export interface Link {
  from: string;
  to: string;
  d: string;
}

export interface TreeLayout {
  width: number;
  height: number;
  cards: Card[];
  links: Link[];
}

interface Point {
  x: number;
  y: number;
}

const MARGIN = 12;

/** The tree of `panel`: its own capabilities and the other stories' ones they build on, as fixed-size cards. */
export function layoutTree(panel: StoryPanel): TreeLayout {
  const cards = new Map<string, Omit<Card, "x" | "y" | "width" | "height">>();
  for (const line of panel.capabilities) {
    cards.set(line.id, {
      id: line.id,
      title: line.title,
      own: true,
      status: line.status,
      reported: line.reported,
      ...(line.verified === undefined ? {} : { verified: line.verified }),
    });
  }
  for (const arrow of panel.arrows) {
    if (cards.has(arrow.to)) continue;
    cards.set(arrow.to, { id: arrow.to, title: arrow.toTitle, own: false, ...(arrow.toStory === undefined ? {} : { story: arrow.toStory }), status: arrow.toStatus });
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "BT", ranksep: 44, nodesep: 20, edgesep: 10, marginx: MARGIN, marginy: MARGIN });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const [id, card] of cards) graph.setNode(id, sizeOf(card.own));
  const arrows = panel.arrows.filter(({ from, to }) => from !== to && cards.has(from) && cards.has(to));
  // Laid out from what is built on up to what builds on it, as 0.2 did; drawn pointing the other way.
  for (const { from, to } of arrows) graph.setEdge(to, from);
  dagre.layout(graph);

  const placed = [...cards.values()].map((card): Card => {
    const node = graph.node(card.id);
    const { width, height } = sizeOf(card.own);
    return { ...card, x: (node?.x ?? 0) - width / 2, y: (node?.y ?? 0) - height / 2, width, height };
  });
  const links = arrows.map(({ from, to }): Link => {
    const points = ((graph.edge(to, from) as { points?: Point[] } | undefined)?.points ?? []).slice().reverse();
    return { from, to, d: pathThrough(points) };
  });
  const size = graph.graph();
  return {
    width: Math.max(Math.ceil(size.width ?? 0), CARD.width + 2 * MARGIN),
    height: Math.max(Math.ceil(size.height ?? 0), CARD.height + 2 * MARGIN),
    cards: placed,
    links,
  };
}

function sizeOf(own: boolean): { width: number; height: number } {
  return own ? { width: CARD.width, height: CARD.height } : { width: OUTSIDE_CARD.width, height: OUTSIDE_CARD.height };
}

/**
 * A smooth path through dagre's edge points: a uniform B-spline (d3's curveBasis, as dagre's own
 * renderer draws), which stays inside the points' hull, so it never loops round a bend.
 */
function pathThrough(points: readonly Point[]): string {
  const at = (point: Point): string => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  const mix = (a: Point, b: Point, c: Point, wa: number, wb: number, wc: number): Point => {
    const w = wa + wb + wc;
    return { x: (a.x * wa + b.x * wb + c.x * wc) / w, y: (a.y * wa + b.y * wb + c.y * wc) / w };
  };
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return "";
  if (points.length < 3) return `M ${at(first)} L ${at(last)}`;
  const ends = [first, ...points, last];
  let d = `M ${at(first)}`;
  for (let i = 2; i < ends.length; i++) {
    const [a, b, c] = [ends[i - 2], ends[i - 1], ends[i]];
    if (a === undefined || b === undefined || c === undefined) continue;
    d += ` C ${at(mix(a, b, b, 2, 1, 0))} ${at(mix(a, b, b, 1, 2, 0))} ${at(mix(a, b, c, 1, 4, 1))}`;
  }
  return `${d} L ${at(last)}`;
}
