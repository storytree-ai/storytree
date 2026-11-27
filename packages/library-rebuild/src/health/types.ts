// Capability 5 · Health record
import type { Anchor, ArcNode, CapabilityNode, ContractNode, EdgeNode, StoryNode } from "../plan/index.js";
import type { FieldsOf, WriteOptions } from "../storage/rules/index.js";
import type { ParkedOn } from "../work/arcs/index.js";

export type HealthState = FieldsOf<"health">["state"];
export type HealthColumnName = FieldsOf<"health">["column"];
export type HealthSource = NonNullable<FieldsOf<"health">["source"]>;
export type SkipKind = "owner" | "other" | `platform:${string}`;

export interface EarlierVerdict {
  state: "passing" | "failing";
  at: string;
}

export interface HealthColumn {
  state: HealthState;
  by?: string;
  at?: string;
  note?: string;
  skip?: SkipKind;
  was?: EarlierVerdict;
  source?: HealthSource;
  tests?: string[];
  flaky?: string[];
}

export interface NodeHealth {
  reported: HealthColumn;
  verified: HealthColumn;
  ci?: HealthColumn;
}

export interface HealthOptions extends WriteOptions {
  readonly by?: string;
  readonly note?: string;
  readonly skip?: SkipKind;
  readonly was?: EarlierVerdict;
  readonly source?: HealthSource;
  readonly tests?: readonly string[];
  readonly flaky?: readonly string[];
}

export interface VerifiedVerdict {
  readonly contractId: string;
  readonly state: HealthState;
  readonly options?: HealthOptions;
}

export interface ToldTurn {
  contract: string;
  title: string;
  at: string;
  released: string[];
  investigated?: string[];
}

export interface FlakeSeen {
  readonly test: string;
  readonly story?: string;
  readonly of?: string;
  readonly contract?: string;
  readonly seen: string;
  readonly evidence: string;
  readonly found: string;
  readonly by: string;
  readonly at?: string;
}

export interface HealthEntry extends HealthColumn {
  column: HealthColumnName;
  at: string;
}

export interface AnnotatedContract extends ContractNode {
  health: NodeHealth;
}

export type CapabilityStatus = "proposed" | "healthy" | "unhealthy" | "untested";

export interface OpenIncrement {
  increment: string;
  title: string;
  active?: true;
  waits?: OpenWait[];
}

export type OpenWait =
  | { kind: "work"; on: string; title: string; state?: "active" | "ready" }
  | { kind: "claim"; on: string; title: string }
  | { kind: "question"; on: string }
  | { kind: "owner" | "event"; note: string };

export interface AnnotatedCapability extends Omit<CapabilityNode, "contracts"> {
  contracts: AnnotatedContract[];
  health: NodeHealth;
  status: CapabilityStatus;
  why?: CapabilityWhy;
  unclaimed?: HealthColumn;
  reportOnly?: true;
  parkedOn?: ParkedOn[];
  openWork?: OpenIncrement[];
}

export type HealthReason = "not built" | "failing" | "not re-run" | "no test names it" | "no live reading" | "acceptance test not run" | "out of CI's reach" | "needs owner";

export interface CapabilityWhy {
  reason: HealthReason;
  mover: "agent" | "owner";
  contracts: string[];
  inside?: { capability: string; title: string }[];
  since?: string;
}

export interface PendingRun {
  since: string;
  by?: string;
  note?: string;
}

export interface HealthWorkItem {
  capability: string;
  title: string;
  story: string;
  status: CapabilityStatus;
  why: CapabilityWhy;
  since: string;
  waits?: PendingRun;
  contractsPass?: true;
  failure?: string;
}

export interface ChangedOnMain {
  commit: string;
  at: string;
}

export interface NamedOnMain extends ChangedOnMain {
  contracts: readonly string[];
}

export interface AnnotatedEdge extends Omit<EdgeNode, "contracts"> {
  contracts: AnnotatedContract[];
}

export interface AnnotatedStory extends Omit<StoryNode, "capabilities" | "edges"> {
  capabilities: AnnotatedCapability[];
  edges?: AnnotatedEdge[];
  health: NodeHealth;
}

export interface AnnotatedTree {
  anchor?: Anchor;
  stories: AnnotatedStory[];
  arcs: ArcNode[];
  unverified?: true;
}
