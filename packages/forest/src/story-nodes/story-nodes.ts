// Capability 1 · Story nodes
import type { AnnotatedTree, Change, HealthState, StorySurvey } from "@storytree/library";

import { placeInRow } from "../planet-places/planet-places.js";

export interface Point {
  x: number;
  y: number;
}

export interface StoryNode {
  id: string;
  title: string;
  reported: HealthState;
  place: number;
  at: Point;
  dependsOn: string[];
}

export function storyNodes(tree: AnnotatedTree, history: readonly Pick<Change, "type" | "action" | "recordId">[], survey: Readonly<Record<string, Pick<StorySurvey, "edges" | "dependsOn" | "mapped">>> = {}): StoryNode[] {
  const created = history.filter(({ type, action }) => type === "story" && action === "created").map(({ recordId }) => recordId);
  const order = [...new Set([...created, ...tree.stories.map(({ id }) => id)])].filter((id) => tree.stories.some((story) => story.id === id));
  const rows = storyRows(tree, order, survey);
  return tree.stories.map((story) => {
    const { row, slot, width, dependsOn } = rows.get(story.id)!;
    return { id: story.id, title: story.title, reported: story.health.reported.state, place: placeInRow(row, slot), at: { x: slot - (width - 1) / 2, y: -row }, dependsOn };
  });
}

function storyRows(tree: AnnotatedTree, order: readonly string[], survey: Readonly<Record<string, Pick<StorySurvey, "edges" | "dependsOn" | "mapped">>>): Map<string, { row: number; slot: number; width: number; dependsOn: string[] }> {
  const owner = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id }) => [id, story.id] as const)));
  const known = new Set(order);
  const mapped = new Set(tree.stories.filter((story) => story.mapped !== undefined).map(({ id }) => id));
  const dependsOn = new Map(tree.stories.map((story) => [story.id, [...new Set([
    ...(survey[story.id]?.edges ?? []).map((edge) => edge.story),
    ...(survey[story.id]?.dependsOn ?? []).filter((other) => survey[story.id]?.mapped !== undefined || mapped.has(other)),
    ...story.capabilities.flatMap(({ dependsOn: on }) => on.flatMap((capability) => owner.get(capability) ?? [])),
  ])].filter((other) => known.has(other) && other !== story.id)]));
  const dependents = new Map(order.map((id) => [id, order.filter((other) => dependsOn.get(other)!.includes(id))]));

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

  const holds = new Map(order.map((id) => {
    const seen = new Set<string>();
    for (const stack = [...dependents.get(id)!]; stack.length > 0;) {
      const next = stack.pop()!;
      if (!seen.has(next) && next !== id) { seen.add(next); stack.push(...dependents.get(next)!); }
    }
    return [id, seen.size];
  }));

  const placed = new Map<string, { row: number; slot: number; width: number; dependsOn: string[] }>();
  const across = (id: string) => { const at = placed.get(id)!; return at.slot - (at.width - 1) / 2; };
  const under = (id: string) => {
    const below = dependsOn.get(id)!.filter((other) => placed.has(other));
    return below.length === 0 ? 0 : below.reduce((sum, other) => sum + across(other), 0) / below.length;
  };
  for (let row = 0, rows = Math.max(0, ...rank.values()) + 1; row < rows; row++) {
    const members = order.filter((id) => rank.get(id) === row);
    let line: string[];
    if (row === 0) {
      line = [];
      [...members].sort((a, b) => holds.get(b)! - holds.get(a)!).forEach((id, k) => (k % 2 === 0 ? line.push(id) : line.unshift(id)));
    } else {
      line = [...members].sort((a, b) => under(a) - under(b));
    }
    line.forEach((id, slot) => placed.set(id, { row, slot, width: line.length, dependsOn: dependsOn.get(id)! }));
  }
  return placed;
}
