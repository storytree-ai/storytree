/** Capability 4: give the library's holding waits names and a queue shape, without rejudging them. */
import type { Hold } from "@storytree/library";
import type { ArcState, IncrementState } from "../work-states/board-states.js";

/** A wait as the queue reads it: `arc` is set when it waits on an increment, naming that increment's arc. */
export interface ArcWait extends Hold {
  title?: string;
  arc?: { id: string };
}
export interface QueueArc {
  id: string;
  title: string;
  state: ArcState;
  /** The arc's own waits, or for a queued arc its increments' waits. */
  waits: readonly ArcWait[];
  /** Its increments, read only when the arc is queued (ADR-0760 D1). */
  bars?: readonly { reading: { state: IncrementState }; waits: readonly ArcWait[] }[];
}
export interface ArcQueue {
  arc: QueueArc;
  queued: ArcQueue[];
}
export interface QueueChip {
  id: string;
  title: string;
  hidden: number;
  otherWaits: number;
  reasons: string[];
  /** The increments it waits on in the arc it is queued behind; empty for an arc-level wait. */
  waitsOn: string[];
}
export interface QueueRun {
  shape: "chain" | "set";
  chips: QueueChip[];
}

const blocker = (wait: ArcWait) => wait.arc?.id ?? wait.on;
const blockers = (arc: QueueArc) => [...new Set(arc.waits.map(blocker))];

/** `arcs` is already sorted and limited to the selected lifecycle. Off-scope blockers hide nothing.
 * An arc folds under one visible blocker: the first in board order. A queued arc folds only when
 * every open increment waits on another visible arc. A cycle is cut at its first arc in board order. */
export function arcQueues(arcs: readonly QueueArc[]): ArcQueue[] {
  const order = new Map(arcs.map(({ id }, index) => [id, index]));
  const onBoard = (id: string, self: QueueArc) => id !== self.id && order.has(id);
  const parents = new Map<string, string>();
  for (const arc of arcs) {
    if (arc.state === "waiting") continue;
    if (arc.state === "queued") {
      const open = (arc.bars ?? []).filter(({ reading }) => reading.state !== "landed" && reading.state !== "not-completed");
      if (!open.length || !open.every(({ waits }) => waits.some((wait) => onBoard(blocker(wait), arc)))) continue;
    }
    const first = blockers(arc).filter((id) => onBoard(id, arc)).sort((a, b) => order.get(a)! - order.get(b)!)[0];
    if (first) parents.set(arc.id, first);
  }
  for (const { id } of arcs) {
    const seen = new Set<string>();
    for (let at = parents.get(id); at && !seen.has(at); at = parents.get(at)) {
      if (at === id) { parents.delete(id); break; }
      seen.add(at);
    }
  }
  const build = (arc: QueueArc): ArcQueue => ({ arc, queued: arcs.filter((other) => parents.get(other.id) === arc.id).map(build) });
  return arcs.filter(({ id }) => !parents.has(id)).map(build);
}

/** Hoist a linear queue; stop at its first branch, whose depth remains visible as +N. */
export function queueRun(queue: ArcQueue): QueueRun {
  const chip = ({ arc }: ArcQueue, behind: string, hidden: number): QueueChip => ({
    id: arc.id, title: arc.title, hidden,
    otherWaits: Math.max(0, blockers(arc).length - 1),
    reasons: arc.waits.map(({ reason }) => reason),
    waitsOn: [...new Set(arc.waits.filter((wait) => wait.arc?.id === behind).map((wait) => wait.title ?? wait.on))],
  });
  if (queue.queued.length !== 1) return { shape: "set", chips: queue.queued.map((child) => chip(child, queue.arc.id, child.queued.length)) };
  const chips: QueueChip[] = [];
  let behind = queue.arc.id;
  let next: ArcQueue | undefined = queue.queued[0];
  while (next) {
    const child: ArcQueue | undefined = next.queued.length === 1 ? next.queued[0] : undefined;
    chips.push(chip(next, behind, child ? 0 : next.queued.length));
    behind = next.arc.id;
    next = child;
  }
  return { shape: "chain", chips };
}

export interface WorkName {
  id: string;
  title: string;
  arc?: { id: string; title: string };
}
export interface NamedWait extends WorkName, Hold {
  warning?: string;
}
export interface BoardWaits {
  on(id: string): NamedWait[];
  heldUpBy(id: string): (WorkName & { reason: string })[];
}

/** Names come from the same project read; holding and permanence come only from waitHolds. */
export function waitsOnBoard(work: readonly WorkName[], holds: ReadonlyMap<string, readonly Hold[]>): BoardWaits {
  const names = new Map(work.map((item) => [item.id, item]));
  const name = (id: string): WorkName => names.get(id) ?? { id, title: `${id} (missing)` };
  return {
    on: (id) => (holds.get(id) ?? []).map((hold) => ({
      ...name(hold.on), ...hold,
      ...(hold.forGood ? { warning: "This wait will not release by itself." } : {}),
    })),
    heldUpBy: (id) => [...holds].flatMap(([waiting, held]) => held.filter(({ on }) => on === id).map(({ reason }) => ({ ...name(waiting), reason }))),
  };
}
