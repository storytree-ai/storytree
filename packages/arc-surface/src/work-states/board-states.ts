// Capability 1 · Work states.
import type { ArcState as Lifecycle, BoardIncrement, Hold, NoteWait } from "@storytree/library";

export type IncrementState = "landed" | "not-completed" | "waiting-on-you" | "in-ci" | "queued" | "blocked" | "held" | "open";
export type ArcState = "closed" | "parked" | "waiting" | "blocked" | "queued" | "in-progress" | "idle" | "ready" | "quiet";
export interface IncrementReading {
  state: IncrementState;
  color: "green" | "red" | "yellow" | "grey";
  progress: "planned" | "in-progress" | "landed" | "not-completed";
  close?: "landed" | "failed" | "withdrawn" | "unrecorded";
  checkBackPassed?: true;
  behind?: string[];
  blockedBy?: string;
}
type Claim = { readonly holder: "live" | "idle" };

export interface IncrementFacts {
  heldOn?: readonly string[];
  waits?: readonly Hold[];
  waitsFor?: readonly NoteWait[];
  behind?: readonly string[];
  claim?: Claim;
  blockedBy?: string;
  inCi?: boolean;
}
export interface ArcFacts {
  openQuestions?: number;
  waits?: readonly Hold[];
  claims?: readonly Claim[];
  increments?: readonly IncrementReading[];
}

export function incrementState(increment: BoardIncrement["fields"], facts: IncrementFacts = {}): IncrementReading {
  if (increment.status === "closed") {
    const landed = increment.outcome?.disposition === "landed" || Boolean(increment.outcome?.pr);
    return {
      state: landed ? "landed" : "not-completed",
      color: landed ? "green" : increment.outcome?.disposition === "withdrawn" ? "grey" : "red",
      progress: landed ? "landed" : "not-completed",
      close: increment.outcome?.disposition ?? "unrecorded",
    };
  }
  const progress = increment.status === "active" ? "in-progress" : "planned";
  const noted = facts.waitsFor ?? [];
  const holding = noted.filter(({ holds }) => holds);
  const passed = noted.some(({ holds }) => !holds) ? { checkBackPassed: true as const } : {};
  const asksYou = holding.some(({ releaser }) => releaser === "owner") && !facts.waits?.length;
  if (facts.heldOn?.length || asksYou) return { state: "waiting-on-you", color: "yellow", progress, ...passed };
  if (facts.behind?.length) return { state: "waiting-on-you", color: "yellow", progress, ...passed, behind: [...facts.behind] };
  if (facts.inCi) return { state: "in-ci", color: "grey", progress, ...passed };
  if (facts.waits?.length || holding.length) return { state: "queued", color: "yellow", progress, ...passed };
  if (facts.claim) return { state: "held", color: "grey", progress, ...passed };
  if (facts.blockedBy) return { state: "blocked", color: "yellow", progress, ...passed, blockedBy: facts.blockedBy };
  return { state: "open", color: "grey", progress, ...passed };
}

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
  if (facts.claims?.some((claim) => claim.holder === "live") || open.some(({ state }) => state === "in-ci")) return "in-progress";
  if (open.some(({ state }) => state === "open")) return "ready";
  return facts.claims?.length ? "idle" : "quiet";
}
