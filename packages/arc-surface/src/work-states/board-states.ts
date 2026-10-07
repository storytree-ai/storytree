/** Capability 1 · Work states. Capability 1, contracts 1.4–1.6. The library decides whether waits/questions still hold;
 * the agent link decides who holds work. This reading only gives those facts their display order. */
import type { Claim } from "@storytree/agent-link";
import type { ArcState as Lifecycle, FieldsOf, Hold, NoteWait } from "@storytree/library";

export type IncrementState = "landed" | "not-completed" | "waiting-on-you" | "queued" | "held" | "open";
export type ArcState = "closed" | "parked" | "waiting" | "blocked" | "queued" | "claimed" | "idle" | "ready" | "quiet";
export interface IncrementReading {
  state: IncrementState;
  color: "green" | "red" | "yellow" | "grey";
  progress: "planned" | "in-progress" | "landed" | "not-completed";
  close?: "landed" | "failed" | "withdrawn" | "unrecorded";
  /** An event wait's check-back day has passed, so it no longer holds the increment (ADR-0938). */
  checkBackPassed?: true;
}
export interface IncrementFacts {
  /** The library's heldOnQuestion reading, not the stored heldOn links. */
  heldOn?: readonly string[];
  /** The library's waitHolds reading, including inherited arc waits. */
  waits?: readonly Hold[];
  /** The library's waitsFor reading (ADR-0938): its waits for the owner or an event, each with whether it still holds. */
  waitsFor?: readonly NoteWait[];
  claim?: Claim;
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
  if (facts.waits?.length || holding.length) return { state: "queued", color: "yellow", progress, ...passed };
  if (facts.claim) return { state: "held", color: "grey", progress, ...passed };
  return { state: "open", color: "grey", progress, ...passed };
}

export function arcState(lifecycle: Lifecycle, facts: ArcFacts = {}): ArcState {
  if (lifecycle !== "active") return lifecycle;
  if (facts.openQuestions) return "waiting";
  if (facts.waits?.length) return "blocked";
  const open = (facts.increments ?? []).filter(({ state }) => state !== "landed" && state !== "not-completed");
  if (open.length && open.every(({ state }) => state === "queued" || state === "waiting-on-you")) return "queued";
  if (facts.claims?.some((claim) => claim.holder === "live")) return "claimed";
  // ADR-0938 D3: an idle claim does not hide free work.
  if (open.some(({ state }) => state === "open")) return "ready";
  return facts.claims?.length ? "idle" : "quiet";
}
