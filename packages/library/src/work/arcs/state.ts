// Capability 11 · Waits
import type { FieldsOf, SchemaRecord } from "../../storage/rules/index.js";

export type IncrementFields = FieldsOf<"increment">;
export type WaitFor = NonNullable<IncrementFields["waitsFor"]>[number];
export type Wait = NonNullable<IncrementFields["waits"]>[number];
export type ArcState = "active" | "parked" | "closed";

export interface WorkItem {
  readonly id: string;
  readonly createdAt: string;
  readonly fields: Partial<IncrementFields>;
}

export interface Hold {
  readonly on: string;
  readonly reason: string;
  readonly forGood: boolean;
  readonly claim?: true;
  readonly title?: string;
}

export interface ClaimReading {
  readonly claimed?: ReadonlySet<string>;
}

export interface NoteWait {
  readonly releaser: WaitFor["releaser"];
  readonly note: string;
  readonly checkBack?: string;
  readonly why?: string;
  readonly rank?: number;
  readonly reviewed?: string;
  readonly merged?: number;
  readonly holds: boolean;
}

export interface Holds {
  readonly waits: Readonly<Record<string, Hold[]>>;
  readonly heldOn: Readonly<Record<string, string[]>>;
  readonly waitsFor?: Readonly<Record<string, NoteWait[]>>;
}

export type Blocker =
  | { readonly kind: "increment"; readonly closed: boolean; readonly landed: boolean }
  | { readonly kind: "arc"; readonly closed: boolean }
  | { readonly kind: "capability"; readonly title: string };

export interface ArcReading {
  readonly state: ArcState;
  readonly wakes?: string;
}

export const OPEN_STATUSES = ["proposal", "active", "ready"] as const;

export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function isOpen(item: { readonly fields: Partial<IncrementFields> }): boolean {
  return item.fields.status !== "closed";
}

export function holdOf(wait: Wait, blocker: Blocker | undefined, { claimed }: ClaimReading = {}): Hold | null {
  const { on, reason } = wait;
  if (blocker === undefined) return { on, reason, forGood: true };
  if (blocker.kind === "capability") {
    return claimed === undefined || claimed.has(on) ? { on, reason, forGood: false, claim: true, title: blocker.title } : null;
  }
  if (blocker.kind === "arc") return blocker.closed ? null : { on, reason, forGood: false };
  if (!blocker.closed) return { on, reason, forGood: false };
  return blocker.landed ? null : { on, reason, forGood: true };
}

export function eventHolds(wait: WaitFor, at: Date): boolean {
  return wait.releaser === "owner" || (wait.checkBack !== undefined && dayOf(at) < wait.checkBack);
}

export function noteWaits(fields: Partial<IncrementFields>, at: Date): NoteWait[] {
  if (fields.status === "closed") return [];
  return (fields.waitsFor ?? []).map((wait) => ({ ...wait, holds: eventHolds(wait, at) }) as NoteWait);
}

export function parkedNow(arc: FieldsOf<"arc">, at: Date): boolean {
  if (arc.parked !== true) return false;
  return arc.parkedUntil === undefined || dayOf(at) < arc.parkedUntil;
}

export function arcReading(arc: SchemaRecord<"arc">, open: readonly WorkItem[], asking: boolean, populated: boolean, openQuestions: ReadonlySet<string>, at: Date): ArcReading {
  if (parkedNow(arc.fields, at)) return { state: "parked", ...(arc.fields.parkedUntil === undefined ? {} : { wakes: arc.fields.parkedUntil }) };
  if (open.length === 0) return { state: populated && !asking ? "closed" : "active" };
  if (asking) return { state: "active" };
  const asleep = new Set<string>();
  const quiet = (item: WorkItem): boolean =>
    item.fields.status !== "active"
    && !(item.fields.waitsFor ?? []).some((wait) => wait.releaser === "owner")
    && !(item.fields.heldOn ?? []).some((question) => openQuestions.has(question));
  for (const item of open) {
    if (quiet(item) && (item.fields.waitsFor ?? []).some((wait) => wait.releaser === "event" && eventHolds(wait, at))) asleep.add(item.id);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const item of open) {
      if (asleep.has(item.id) || !quiet(item)) continue;
      const waits = item.fields.waits ?? [];
      if (waits.length > 0 && waits.every(({ on }) => asleep.has(on))) {
        asleep.add(item.id);
        grew = true;
      }
    }
  }
  if (!open.every((item) => asleep.has(item.id))) return { state: "active" };
  const days = open.flatMap((item) => (item.fields.waitsFor ?? []).filter((wait) => wait.releaser === "event" && eventHolds(wait, at)).map((wait) => wait.checkBack!));
  return { state: "parked", wakes: days.sort()[0]! };
}

export function byCreation<T extends { readonly id: string; readonly createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
}
