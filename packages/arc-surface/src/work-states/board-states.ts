/** Capability 1 · Work states. Capability 1, contracts 1.4–1.6. The library decides whether waits/questions still hold;
 * the agent link decides who holds work. This reading only gives those facts their display order. */
import type { Claim } from "@storytree/agent-link";
import type { ArcState as Lifecycle, FieldsOf, Hold } from "@storytree/library";

export type IncrementState = "landed" | "not-completed" | "waiting-on-you" | "queued" | "held" | "open";
export type ArcState = "closed" | "parked" | "waiting" | "blocked" | "queued" | "claimed" | "idle" | "ready" | "quiet";
export interface IncrementReading {
  state: IncrementState;
  color: "green" | "red" | "yellow" | "grey";
  progress: "planned" | "in-progress" | "landed" | "not-completed";
  close?: "landed" | "failed" | "withdrawn" | "unrecorded";
}
export interface IncrementFacts {
  /** The library's heldOnQuestion reading, not the stored heldOn links. */
  heldOn?: readonly string[];
  /** The library's waitHolds reading, including inherited arc waits. */
  waits?: readonly Hold[];
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
  if (facts.heldOn?.length) return { state: "waiting-on-you", color: "yellow", progress };
  if (facts.waits?.length) return { state: "queued", color: "yellow", progress };
  if (facts.claim) return { state: "held", color: "grey", progress };
  return { state: "open", color: "grey", progress };
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
