/**
 * Capability 1 · Story nodes (the forest story): the forest keeps one story node for every story
 * in the project: where the story sits in the forest, with its title and its overall health. Nodes
 * follow the library, so a new story appears as a new node and a retired story's node goes, with
 * nothing arranged by hand.
 *
 * Its shelf's founding book (P1): a node's place comes from its story alone. The first story the
 * project ever had sits at the centre, and each later one takes the next place on a spiral, in the
 * order the stories were created, for good. A retired story's place stays open sea and is never
 * given to another, so nothing ever moves a node. A later placement, such as the planet of
 * ADR-0629, is a new book: another rule for where a place is, in place of placeOnSpiral.
 *
 * Everything here is a pure function of what the library hands the forest, so it is tested
 * without a database.
 */
import type { AnnotatedTree, Change, HealthState } from "@storytree/library";

/** A point on the forest's ground, in place-widths from its centre. */
export interface Point {
  x: number;
  y: number;
}

/** One story, as the forest keeps it. */
export interface StoryNode {
  /** The story's id in the library. */
  id: string;
  title: string;
  /**
   * The story's overall health as its agent reports it: the library's reported column, rolled up
   * from its contracts. It is the agent's word, and is always labelled so (ADR-0630).
   */
  reported: HealthState;
  /** Its place: 1 for the first story the project ever had, 2 for the next, and so on, retired stories included. */
  place: number;
  /** Where its place is. */
  at: Point;
}

/**
 * The story nodes of a project: one for each story in `tree` (the library's projectTree()), in the
 * tree's order. `history` is the project's changes from the start, as changesSince(0) hands them
 * out; the order the stories were created in, retired ones included, is read from it. A story the
 * history does not show being created (a history read from later than the start) takes a place
 * after every story it does show.
 */
export function storyNodes(tree: AnnotatedTree, history: readonly Change[]): StoryNode[] {
  const created = history.filter(({ type, action }) => type === "story" && action === "created").map(({ recordId }) => recordId);
  const order = [...new Set([...created, ...tree.stories.map(({ id }) => id)])];
  return tree.stories.map((story) => {
    const place = order.indexOf(story.id) + 1;
    return { id: story.id, title: story.title, reported: story.health.reported.state, place, at: placeOnSpiral(place) };
  });
}

/**
 * Where place `place` is: place 1 at the centre, and each later place one place-width further
 * along a spiral whose turns are one place-width apart, starting one place-width out. So every
 * place is about a place-width from the one before it, and none is ever closer than that to
 * another.
 */
function placeOnSpiral(place: number): Point {
  if (place <= 1) return { x: 0, y: 0 };
  // The spiral is r = 1 + θ/2π, and measured round the centre the length along it to θ is
  // θ + θ²/4π. Place n sits n - 2 place-widths along it from place 2, at (1, 0), so
  // r = √(1 + (n - 2)/π).
  const r = Math.sqrt(1 + (place - 2) / Math.PI);
  const angle = 2 * Math.PI * (r - 1);
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}
