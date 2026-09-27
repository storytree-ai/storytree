/** Capability 1's founding book (D1): knowledge hangs under its shelves, as deep as its longest chain. */
import type { Change } from "@storytree/library";

import { linksOf, type Knowledge } from "../ghosts/ghosts.js";

/** What an empty shelf says. */
export const EMPTY_SHELF = "no knowledge on this shelf yet";
/** What a loop says: the knowledge graph refuses loops (ADR-0647 D2), so one met here is an error. */
export const LOOP_LABEL = "loop: a refused shape; the knowledge graph allows no loops (ADR-0647)";

/** A story's or capability's shelf: an entrance into the core, on its story's island. */
export interface Shelf {
  node: string;
  story: string;
  /** Its front covers, oldest first. */
  covers: string[];
  empty?: string;
}

export interface Placement {
  note: string;
  /** The longest chain from a shelf, the shelf-to-cover step counting 1. */
  depth: number;
  /** The shelf it hangs under: a cover's own, else the oldest shelf that reaches it. */
  home: string;
  /** Every shelf that reaches it, oldest first. */
  entrances: string[];
  /** The loop it belongs to, if any. */
  loop: string | undefined;
}

export interface Loop {
  id: string;
  members: string[];
  /** The group's depth; undefined when no shelf reaches it. */
  depth: number | undefined;
  label: string;
}

export interface Core {
  shelves: Shelf[];
  placed: ReadonlyMap<string, Placement>;
  /** Active notes no shelf reaches, by id. */
  outside: string[];
  loops: Loop[];
}

/**
 * Hang a project's active notes (capability 2's `knowledge`) under the shelves of its live stories
 * and capabilities, read from the same change history. Links are followed in their stored
 * direction, between active notes only. Notes that all lead back to one another form one group,
 * which takes one depth and is reported as a loop; depth is then the longest chain over the groups.
 */
export function underShelves(changes: readonly Change[], { notes, active }: Knowledge): Core {
  const nodes = new Map<string, { story: string; seq: number }>();
  for (const change of changes) {
    if (change.type !== "story" && change.type !== "capability") continue;
    if (change.action === "retired") nodes.delete(change.recordId);
    else {
      const story = change.type === "story" ? change.recordId : String(change.record.fields.story);
      nodes.set(change.recordId, { story, seq: nodes.get(change.recordId)?.seq ?? change.seq });
    }
  }
  const order = [...nodes.keys()];
  const age = (node: string) => order.indexOf(node);
  const byAge = (a: string, b: string) => age(a) - age(b);

  const noteAge = new Map<string, number>();
  for (const change of changes) if (change.action === "created" && !noteAge.has(change.recordId)) noteAge.set(change.recordId, change.seq);
  const coverShelf = new Map<string, string>();
  for (const id of active) {
    const shelf = notes.get(id)?.fields.frontCoverOf;
    if (typeof shelf === "string" && nodes.has(shelf)) coverShelf.set(id, shelf);
  }
  const shelves: Shelf[] = order.map((node) => {
    const covers = [...coverShelf].filter(([, shelf]) => shelf === node).map(([cover]) => cover).sort((a, b) => (noteAge.get(a) ?? 0) - (noteAge.get(b) ?? 0));
    return { node, story: nodes.get(node)!.story, covers, ...(covers.length === 0 ? { empty: EMPTY_SHELF } : {}) };
  });

  const out = new Map<string, string[]>();
  for (const id of active) out.set(id, [...new Set(linksOf(notes.get(id)!))].filter((target) => active.has(target)));
  const { groupOf, groups } = stronglyConnected([...active].sort(), out);
  const groupOut = groups.map(() => new Set<number>());
  for (const [id, targets] of out) for (const target of targets) if (groupOf.get(id) !== groupOf.get(target)) groupOut[groupOf.get(id)!]!.add(groupOf.get(target)!);

  // Tarjan's algorithm finds groups in reverse topological order, so walk them backwards.
  const depth: (number | undefined)[] = groups.map(() => undefined);
  const reachedFrom: Set<string>[] = groups.map(() => new Set());
  for (const [cover, shelf] of coverShelf) {
    const group = groupOf.get(cover)!;
    depth[group] = 1;
    reachedFrom[group]!.add(shelf);
  }
  for (let group = groups.length - 1; group >= 0; group--) {
    const at = depth[group];
    if (at === undefined) continue;
    for (const next of groupOut[group]!) {
      depth[next] = Math.max(depth[next] ?? 0, at + 1);
      for (const shelf of reachedFrom[group]!) reachedFrom[next]!.add(shelf);
    }
  }

  const loops: Loop[] = [];
  const loopOf = new Map<number, string>();
  groups.forEach((members, group) => {
    if (members.length === 1 && !out.get(members[0]!)!.includes(members[0]!)) return;
    const id = `loop:${members[0]}`;
    loopOf.set(group, id);
    loops.push({ id, members, depth: depth[group], label: LOOP_LABEL });
  });

  const placed = new Map<string, Placement>();
  const outside: string[] = [];
  for (const id of [...active].sort()) {
    const group = groupOf.get(id)!;
    const at = depth[group];
    if (at === undefined) {
      outside.push(id);
      continue;
    }
    const entrances = [...reachedFrom[group]!].sort(byAge);
    placed.set(id, { note: id, depth: at, home: coverShelf.get(id) ?? entrances[0]!, entrances, loop: loopOf.get(group) });
  }
  return { shelves, placed, outside, loops };
}

/** Tarjan's strongly connected groups, each sorted, in reverse topological order. */
function stronglyConnected(ids: readonly string[], out: ReadonlyMap<string, readonly string[]>) {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  const groupOf = new Map<string, number>();

  const visit = (start: string) => {
    // Iterative, so a long chain cannot overflow the call stack.
    const frames: { id: string; next: number }[] = [{ id: start, next: 0 }];
    index.set(start, index.size);
    low.set(start, index.get(start)!);
    stack.push(start);
    onStack.add(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const targets = out.get(frame.id) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next++]!;
        if (!index.has(target)) {
          index.set(target, index.size);
          low.set(target, index.get(target)!);
          stack.push(target);
          onStack.add(target);
          frames.push({ id: target, next: 0 });
        } else if (onStack.has(target)) low.set(frame.id, Math.min(low.get(frame.id)!, index.get(target)!));
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === index.get(frame.id)) {
        const members: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          groupOf.set(member, groups.length);
          members.push(member);
        } while (member !== frame.id);
        groups.push(members.sort());
      }
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return { groups, groupOf };
}
