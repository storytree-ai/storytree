/**
 * Capability 1 · Story nodes (the forest story): the forest keeps one story node for every story
 * in the project: where the story sits in the forest, with its title and its overall health. Nodes
 * follow the library, so a new story appears as a new node and a retired story's node goes, with
 * nothing arranged by hand.
 *
 * A node's place is a row and a slot in it, by dependency depth (the rows decision, superseding the
 * creation-order places of ADR-0646, ported from 0.2's ranking): a story depending on nothing is in the
 * bottom row, and every other story is one row above the deepest story it depends on, where a story
 * depends on another when one of its capabilities depends on one of the other's. The bottom row is
 * ordered with the story most depended on (directly or not) in the middle and the rest outward; a
 * higher row by where the stories it depends on sit in theirs. Ties go by the order the stories were
 * created in, and a loop in the dependencies is broken where it is found, so it never stops the layout.
 * Where the code survey says which other stories' packages a story's package depends on, those are
 * its dependencies instead of its capabilities' (ADR-0840 D2): the code is the source of truth for
 * the direction, so a code edge the plan never recorded still places the island.
 *
 * Everything here is a pure function of what the library hands the forest, so it is tested
 * without a database.
 */
import type { AnnotatedTree, Change, HealthState } from "@storytree/library";

import type { StorySurvey } from "@storytree/map";
import { placeInRow } from "../planet-places/planet-places.js";

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
  /** Its place: its row and its slot in that row (planet-places' placeInRow). */
  place: number;
  /** Where its place is on flat ground: its slot across the row from the row's middle, and its row northward (−y). */
  at: Point;
}

/**
 * The story nodes of a project: one for each story in `tree` (the library's projectTree()), in the
 * tree's order. `history` is the project's changes from the start, as changesSince(0) hands them
 * out; the order the stories were created in, which breaks ties in a row, is read from it. A story
 * the history does not show being created comes after every story it does show. `survey` is the
 * project's code survey: a story it names package dependencies for is placed by those.
 */
export function storyNodes(tree: AnnotatedTree, history: readonly Change[], survey: Readonly<Record<string, Pick<StorySurvey, "dependsOn">>> = {}): StoryNode[] {
  const created = history.filter(({ type, action }) => type === "story" && action === "created").map(({ recordId }) => recordId);
  const order = [...new Set([...created, ...tree.stories.map(({ id }) => id)])].filter((id) => tree.stories.some((story) => story.id === id));
  const rows = storyRows(tree, order, survey);
  return tree.stories.map((story) => {
    const { row, slot, width } = rows.get(story.id)!;
    return { id: story.id, title: story.title, reported: story.health.reported.state, place: placeInRow(row, slot), at: { x: slot - (width - 1) / 2, y: -row } };
  });
}

/** Each story's row, its slot in the row from the west, and how many the row holds; `order` is the stories in creation order. */
function storyRows(tree: AnnotatedTree, order: readonly string[], survey: Readonly<Record<string, Pick<StorySurvey, "dependsOn">>>): Map<string, { row: number; slot: number; width: number }> {
  const owner = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id }) => [id, story.id] as const)));
  const known = new Set(order);
  const dependsOn = new Map(tree.stories.map((story) => [story.id, survey[story.id]?.dependsOn?.filter((other) => known.has(other) && other !== story.id)
    ?? [...new Set(story.capabilities.flatMap(({ dependsOn: on }) =>
      on.flatMap((capability) => { const other = owner.get(capability); return other === undefined || other === story.id ? [] : [other]; })))]]));
  const dependents = new Map(order.map((id) => [id, order.filter((other) => dependsOn.get(other)!.includes(id))]));

  // Longest path from the bottom: one above the deepest dependency; a dependency still being visited closes a loop and counts as none.
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    const row = Math.max(0, ...dependsOn.get(id)!.map((other) => rankOf(other) + 1));
    visiting.delete(id);
    rank.set(id, row);
    return row;
  };
  order.forEach(rankOf);

  // How many stories rest on each, directly or not.
  const holds = new Map(order.map((id) => {
    const seen = new Set<string>();
    for (const stack = [...dependents.get(id)!]; stack.length > 0;) {
      const next = stack.pop()!;
      if (!seen.has(next) && next !== id) { seen.add(next); stack.push(...dependents.get(next)!); }
    }
    return [id, seen.size];
  }));

  const placed = new Map<string, { row: number; slot: number; width: number }>();
  const across = (id: string) => { const at = placed.get(id)!; return at.slot - (at.width - 1) / 2; };
  const under = (id: string) => {
    const below = dependsOn.get(id)!.filter((other) => placed.has(other));
    return below.length === 0 ? 0 : below.reduce((sum, other) => sum + across(other), 0) / below.length;
  };
  for (let row = 0, rows = Math.max(0, ...rank.values()) + 1; row < rows; row++) {
    const members = order.filter((id) => rank.get(id) === row);
    let line: string[];
    if (row === 0) {
      // Most held up in the middle, the rest alternately to either side.
      line = [];
      [...members].sort((a, b) => holds.get(b)! - holds.get(a)!).forEach((id, k) => (k % 2 === 0 ? line.push(id) : line.unshift(id)));
    } else {
      line = [...members].sort((a, b) => under(a) - under(b));
    }
    line.forEach((id, slot) => placed.set(id, { row, slot, width: line.length }));
  }
  return placed;
}
