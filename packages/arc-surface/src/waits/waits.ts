/** Capability 4: give the library's holding waits names and a queue shape, without rejudging them. */
import type { Hold } from "@storytree/library";
import type { ArcState } from "../work-states/board-states.js";

export interface QueueArc {
  id: string;
  title: string;
  state: ArcState;
  waits: readonly Hold[];
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
}
export interface QueueRun {
  shape: "chain" | "set";
  chips: QueueChip[];
}

/** `arcs` is already sorted and limited to the selected lifecycle. Off-scope blockers hide nothing. */
export function arcQueues(arcs: readonly QueueArc[]): ArcQueue[] {
  const visible = new Set(arcs.map(({ id }) => id));
  const nested = (arc: QueueArc) => arc.state !== "waiting" && arc.waits.some(({ on }) => visible.has(on));
  const build = (arc: QueueArc, ancestors: ReadonlySet<string>): ArcQueue => {
    if (ancestors.has(arc.id)) return { arc, queued: [] };
    const path = new Set(ancestors).add(arc.id);
    return { arc, queued: arcs.filter((other) => nested(other) && other.waits.some(({ on }) => on === arc.id)).map((child) => build(child, path)) };
  };
  return arcs.filter((arc) => !nested(arc)).map((arc) => build(arc, new Set()));
}

/** Hoist a linear queue; stop at its first branch, whose depth remains visible as +N. */
export function queueRun(queue: ArcQueue): QueueRun {
  const chip = ({ arc }: ArcQueue, hidden: number): QueueChip => ({
    id: arc.id, title: arc.title, hidden,
    otherWaits: Math.max(0, arc.waits.length - 1),
    reasons: arc.waits.map(({ reason }) => reason),
  });
  if (queue.queued.length !== 1) return { shape: "set", chips: queue.queued.map((child) => chip(child, child.queued.length)) };
  const chips: QueueChip[] = [];
  let next: ArcQueue | undefined = queue.queued[0];
  while (next) {
    const child: ArcQueue | undefined = next.queued.length === 1 ? next.queued[0] : undefined;
    chips.push(chip(next, child ? 0 : next.queued.length));
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
