// Capability 5 · Health record
import type { AnnotatedCapability, CapabilityStatus, CapabilityWhy, HealthColumn, HealthReason, HealthState } from "./types.js";

export const NOT_VERIFIED = "storytree does not check this project's tests yet";
export const ACCEPTANCE = "agentic-user-acceptance-testing";
export const OBSERVED = "observability-as-proof";

export interface WhyItem {
  readonly id?: string;
  readonly verified: HealthColumn;
  readonly proof?: string;
}

export function capabilityStatus(proposed: boolean, states: readonly HealthState[]): CapabilityStatus {
  if (proposed) return "proposed";
  if (states.includes("failing")) return "unhealthy";
  return allPassing(states) ? "healthy" : "untested";
}

export function rolledUp(states: readonly HealthState[]): HealthState {
  if (states.includes("failing")) return "failing";
  return allPassing(states) ? "passing" : "not-checked";
}

const unchecked = ({ verified }: WhyItem): boolean => verified.state === "not-checked";
const never = (item: WhyItem): boolean => unchecked(item) && item.verified.at === undefined;
const waitsOnSomeone = ({ verified }: WhyItem): boolean => verified.skip === "owner" || verified.skip?.startsWith("platform:") === true;

const LADDER: readonly (readonly [HealthReason, (item: WhyItem) => boolean])[] = [
  ["failing", ({ verified }) => verified.state === "failing"],
  ["not re-run", (item) => unchecked(item) && item.verified.at !== undefined && !waitsOnSomeone(item)],
  ["no test names it", (item) => never(item) && item.proof !== ACCEPTANCE && item.proof !== OBSERVED],
  ["no live reading", (item) => never(item) && item.proof === OBSERVED],
  ["acceptance test not run", (item) => never(item) && item.proof === ACCEPTANCE],
  ["out of CI's reach", (item) => unchecked(item) && item.verified.skip?.startsWith("platform:") === true],
  ["needs owner", (item) => unchecked(item) && item.verified.skip === "owner"],
];

export function capabilityWhy(proposed: boolean, contracts: readonly WhyItem[]): CapabilityWhy | undefined {
  if (proposed) return { reason: "not built", mover: "agent", contracts: [] };
  if (allPassing(contracts.map(({ verified }) => verified.state))) return undefined;
  for (const [reason, carries] of LADDER) {
    const carrying = contracts.filter(carries);
    if (carrying.length > 0) return whyOf(reason, carrying);
  }
  return { reason: "no test names it", mover: "agent", contracts: [] };
}

export function whyOf(reason: HealthReason, carrying: readonly WhyItem[]): CapabilityWhy {
  const since = carrying.flatMap(({ verified }) => (verified.at === undefined ? [] : [verified.at])).sort()[0];
  return {
    reason,
    mover: reason === "needs owner" ? "owner" : "agent",
    contracts: carrying.flatMap(({ id }) => (id === undefined ? [] : [id])),
    ...(since === undefined ? {} : { since }),
  };
}

export function wordAndWhy(capability: Pick<AnnotatedCapability, "status" | "why" | "contracts" | "health" | "reportOnly">): string {
  if (capability.reportOnly === true) return `the agent reports ${capability.health.reported.state}; ${NOT_VERIFIED}`;
  const why = capability.why;
  if (why === undefined) return capability.status;
  const reason = why.inside === undefined ? why.reason : `failing inside ${why.inside.map(({ title }) => title).join(", ")}`;
  return `${capability.status} — ${reason}, ${why.mover === "agent" ? "the agent's" : "the owner's"} to move`;
}

function allPassing(states: readonly HealthState[]): boolean {
  return states.length > 0 && states.every((state) => state === "passing");
}
