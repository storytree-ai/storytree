/** Capability 1 · Work states. Capability 1, contracts 1.4–1.6. The library decides whether waits/questions still hold;
 * the agent link decides who holds work. This reading only gives those facts their display order. */
import type { Claim } from "@storytree/agent-link";
import type { ArcState as Lifecycle, FieldsOf, Hold, NoteWait } from "@storytree/library";

export type IncrementState = "landed" | "not-completed" | "waiting-on-you" | "queued" | "blocked" | "held" | "open";
export type ArcState = "closed" | "parked" | "waiting" | "blocked" | "queued" | "in-progress" | "idle" | "ready" | "quiet";
export interface IncrementReading {
  state: IncrementState;
  color: "green" | "red" | "yellow" | "grey";
  progress: "planned" | "in-progress" | "landed" | "not-completed";
  close?: "landed" | "failed" | "withdrawn" | "unrecorded";
  /** An event wait's check-back day has passed, so it no longer holds the increment (ADR-0938). */
  checkBackPassed?: true;
  /** The owner's questions its waits on other work end on, when they make it wait on you. */
  behind?: string[];
  /** The increment holding a capability its list names, when it reads blocked (ADR-0949 D3). */
  blockedBy?: string;
}
export interface IncrementFacts {
  /** The library's heldOnQuestion reading, not the stored heldOn links. */
  heldOn?: readonly string[];
  /** The library's waitHolds reading, including inherited arc waits. */
  waits?: readonly Hold[];
  /** The library's waitsFor reading (ADR-0938): its waits for the owner or an event, each with whether it still holds. */
  waitsFor?: readonly NoteWait[];
  /** The owner's questions its waits on other work end on, however many hops away (questionsBehind). */
  behind?: readonly string[];
  claim?: Claim;
  /** Another increment a live session holds that holds a capability this one's list names (ADR-0949 D3). */
  blockedBy?: string;
}
export interface ArcFacts {
  openQuestions?: number;
  waits?: readonly Hold[];
  /** Only claims on this arc's own work (capability 2). */
  claims?: readonly Claim[];
  /** Its increments' own readings; closed ones are ignored (ADR-0760 D1). */
  increments?: readonly IncrementReading[];
}

export function incrementState(increment: FieldsOf<"increment">, facts: IncrementFacts = {}): IncrementReading {
  if (increment.status === "closed") {
    const landed = increment.outcome?.disposition === "landed" || Boolean(increment.outcome?.pr);
    return {
      state: landed ? "landed" : "not-completed",
      color: landed ? "green" : "red",
      progress: landed ? "landed" : "not-completed",
      close: increment.outcome?.disposition ?? "unrecorded",
    };
  }
  const progress = increment.status === "active" ? "in-progress" : "planned";
  // ADR-0938: a wait for the owner reads like a question held on him, a wait for an event like a wait on work.
  // An event wait whose check-back passed holds nothing, but the reading says so.
  const noted = facts.waitsFor ?? [];
  const holding = noted.filter(({ holds }) => holds);
  const passed = noted.some(({ holds }) => !holds) ? { checkBackPassed: true as const } : {};
  if (facts.heldOn?.length || holding.some(({ releaser }) => releaser === "owner")) return { state: "waiting-on-you", color: "yellow", progress, ...passed };
  // Work it waits on is held on the owner's question, so the owner, not the work, is what it waits for.
  if (facts.behind?.length) return { state: "waiting-on-you", color: "yellow", progress, ...passed, behind: [...facts.behind] };
  if (facts.waits?.length || holding.length) return { state: "queued", color: "yellow", progress, ...passed };
  if (facts.claim) return { state: "held", color: "grey", progress, ...passed };
  if (facts.blockedBy) return { state: "blocked", color: "yellow", progress, ...passed, blockedBy: facts.blockedBy };
  return { state: "open", color: "grey", progress, ...passed };
}

/**
 * The owner's questions holding the work `id` waits on, following waits through other work however
 * many hops away; its own questions hold it directly and are not among them. A wait loop ends.
 */
export function questionsBehind(id: string, holds: { waits: Readonly<Record<string, readonly Hold[]>>; heldOn: Readonly<Record<string, readonly string[]>> }): string[] {
  const seen = new Set([id]);
  const questions = new Set<string>();
  const next = [...(holds.waits[id] ?? [])].map(({ on }) => on);
  for (let on = next.shift(); on !== undefined; on = next.shift()) {
    if (seen.has(on)) continue;
    seen.add(on);
    for (const question of holds.heldOn[on] ?? []) questions.add(question);
    next.push(...(holds.waits[on] ?? []).map((hold) => hold.on));
  }
  return [...questions];
}

export function arcState(lifecycle: Lifecycle, facts: ArcFacts = {}): ArcState {
  if (lifecycle !== "active") return lifecycle;
  if (facts.openQuestions) return "waiting";
  if (facts.waits?.length) return "blocked";
  const open = (facts.increments ?? []).filter(({ state }) => state !== "landed" && state !== "not-completed");
  if (open.length && open.every(({ state }) => state === "queued" || state === "waiting-on-you" || state === "blocked")) return "queued";
  if (facts.claims?.some((claim) => claim.holder === "live")) return "in-progress";
  // ADR-0938 D3: an idle claim does not hide free work.
  if (open.some(({ state }) => state === "open")) return "ready";
  return facts.claims?.length ? "idle" : "quiet";
}
