// Capability 5 · Health record
import type { CapabilityNode, ContractNode, ProjectTree, StoryNode } from "../plan/index.js";
import type { SchemaRecord } from "../storage/rules/index.js";
import type { ParkedOn } from "../work/arcs/index.js";
import { columnOf, contractHealth, type Reading } from "./reading.js";
import type { AnnotatedCapability, AnnotatedContract, AnnotatedTree, CapabilityWhy, HealthColumn, HealthState, NodeHealth, OpenIncrement, OpenWait } from "./types.js";
import { capabilityStatus, capabilityWhy, rolledUp, whyOf, type WhyItem } from "./word.js";

export interface TreeInputs {
  readonly tree: ProjectTree;
  readonly reading: Reading;
  readonly now: Date;
  readonly parked?: ReadonlyMap<string, readonly ParkedOn[]> | undefined;
  readonly open: readonly SchemaRecord<"increment">[];
  readonly waitsOf: (increment: string) => OpenWait[];
}

export function annotateTree(inputs: TreeInputs): AnnotatedTree {
  const { tree, reading, now } = inputs;
  const contract = (node: ContractNode): AnnotatedContract => ({ ...node, health: contractHealth(reading, node, now) });
  const stories = tree.stories.map((story) => {
    const { edges, capabilities, ...rest } = story;
    const contracts = new Map(capabilities.map((capability) => [capability.id, capability.contracts.map(contract)]));
    return {
      ...rest,
      ...(edges === undefined ? {} : { edges: edges.map((edge) => ({ ...edge, contracts: edge.contracts.map(contract) })) }),
      health: rolledHealth([...contracts.values()].flat(), capabilities.map(({ id }) => unclaimedOf(reading, id))),
      capabilities: capabilities.map((capability) => annotateCapability(capability, story, contracts, inputs)),
    };
  });
  return { ...(tree.anchor === undefined ? {} : { anchor: tree.anchor }), stories, arcs: tree.arcs, ...(reading.checked ? {} : { unverified: true as const }) };
}

export function rolledHealth(contracts: readonly { readonly health: NodeHealth }[], readings: readonly (HealthColumn | undefined)[]): NodeHealth {
  return {
    reported: { state: rolledUp(contracts.map(({ health }) => health.reported.state)) },
    verified: { state: rolledUp([...contracts.map(({ health }) => health.verified.state), ...counted(readings)]) },
  };
}

export function unclaimedOf(reading: Reading, capability: string): HealthColumn | undefined {
  const stored = reading.verified.get(capability);
  return stored === undefined ? undefined : columnOf(stored);
}

export function inside<T extends { readonly id: string; readonly parent?: string | undefined }>(id: string, capabilities: readonly T[], seen = new Set<string>([id])): T[] {
  return capabilities.filter(({ parent }) => parent === id).flatMap((child) => {
    if (seen.has(child.id)) return [];
    seen.add(child.id);
    return [child, ...inside(child.id, capabilities, seen)];
  });
}

function annotateCapability(capability: CapabilityNode, story: StoryNode, annotated: ReadonlyMap<string, AnnotatedContract[]>, inputs: TreeInputs): AnnotatedCapability {
  const { reading, parked } = inputs;
  const contracts = annotated.get(capability.id) ?? [];
  const within = inside(capability.id, story.capabilities);
  const held = [...contracts, ...within.flatMap(({ id }) => annotated.get(id) ?? [])];
  const unclaimed = unclaimedOf(reading, capability.id);
  const readings = [unclaimed, ...within.map(({ id }) => unclaimedOf(reading, id))];
  const states = [...held.map(({ health }) => health.verified.state), ...counted(readings)];
  const explored = story.mapped !== undefined && capability.proposed;
  const tied = [...contracts.map(({ health }) => health.verified.state), ...counted([unclaimed])].some((state) => state !== "not-checked");
  const proposed = capability.proposed && !(explored && tied);
  const status = capabilityStatus(proposed, states);
  const reportOnly = !reading.checked && !capability.proposed;
  const why = (explored && contracts.length === 0 && !tied) || reportOnly ? undefined : whyFor(proposed, contracts, unclaimed, within, annotated);
  const listed = parked?.get(capability.id);
  const openWork = openWorkOf(capability, inputs);
  return {
    ...capability,
    contracts,
    health: rolledHealth(held, readings),
    status,
    ...(why === undefined ? {} : { why }),
    ...(unclaimed === undefined ? {} : { unclaimed }),
    ...(reportOnly ? { reportOnly: true as const } : {}),
    ...(listed !== undefined && (status === "proposed" || status === "untested") ? { parkedOn: [...listed] } : {}),
    ...(openWork.length === 0 ? {} : { openWork }),
  };
}

function whyFor(proposed: boolean, contracts: readonly AnnotatedContract[], unclaimed: HealthColumn | undefined, within: readonly CapabilityNode[], annotated: ReadonlyMap<string, AnnotatedContract[]>): CapabilityWhy | undefined {
  const items: WhyItem[] = [
    ...contracts.map(({ id, health, proof }) => ({ id, verified: health.verified, ...(proof === undefined ? {} : { proof: proof.by }) })),
    ...(unclaimed === undefined || unclaimed.state === "not-checked" ? [] : [{ verified: unclaimed }]),
  ];
  const own = capabilityWhy(proposed, items);
  if (proposed || own?.reason === "failing") return own;
  const failingInside = within.flatMap((child) => {
    const failing = (annotated.get(child.id) ?? []).filter(({ health }) => health.verified.state === "failing");
    return failing.length === 0 ? [] : [{ child, failing }];
  });
  if (failingInside.length === 0) return own;
  const why = whyOf("failing", failingInside.flatMap(({ failing }) => failing.map(({ id, health }) => ({ id, verified: health.verified }))));
  return { ...why, inside: failingInside.map(({ child }) => ({ capability: child.id, title: child.title.replace(/^\d+ · /, "") })) };
}

function openWorkOf(capability: CapabilityNode, { open, waitsOf }: TreeInputs): OpenIncrement[] {
  const contracts = new Set(capability.contracts.map(({ id }) => id));
  const naming = open.filter(({ fields }) => (fields.capabilities ?? []).includes(capability.id) || (fields.links ?? []).some((link) => contracts.has(link)));
  return naming.map(({ id, fields }, index) => {
    const waits = index === 0 ? waitsOf(id) : [];
    return { increment: id, title: fields.title, ...(fields.status === "active" ? { active: true as const } : {}), ...(waits.length === 0 ? {} : { waits }) };
  });
}

function counted(readings: readonly (HealthColumn | undefined)[]): HealthState[] {
  return readings.flatMap((reading) => (reading === undefined || reading.state === "not-checked" ? [] : [reading.state]));
}
