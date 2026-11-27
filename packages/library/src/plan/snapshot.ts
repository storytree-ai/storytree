// Capability 4 · Work model
import type { RecordType, SchemaRecord, SchemaRecords } from "../storage/rules/index.js";
import { capabilityNumber, contractNumber, testedNumber, type ContractNumber } from "./numbers.js";

export interface Plan {
  readonly stories: Map<string, SchemaRecord<"story">>;
  readonly capabilities: Map<string, SchemaRecord<"capability">>;
  readonly edges: SchemaRecord<"edge">[];
  readonly contracts: SchemaRecord<"contract">[];
}

export async function readPlan(records: SchemaRecords): Promise<Plan> {
  const stories = await listed(records, "story");
  const capabilities = await listed(records, "capability");
  return {
    stories: new Map(stories.map((story) => [story.id, story])),
    capabilities: new Map(capabilities.map((capability) => [capability.id, capability])),
    edges: await listed(records, "edge"),
    contracts: await listed(records, "contract"),
  };
}

export async function listed<T extends RecordType>(records: SchemaRecords, type: T): Promise<SchemaRecord<T>[]> {
  return (await records.list(type)).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
}

export function edgesFrom(plan: Plan, id: string): SchemaRecord<"edge">[] {
  return plan.edges.filter((edge) => edge.fields.from === id);
}

export function edgesTo(plan: Plan, id: string): SchemaRecord<"edge">[] {
  return plan.edges.filter((edge) => edge.fields.to === id);
}

export function dependsOnOf(plan: Plan, id: string): string[] {
  return [...edgesFrom(plan, id).map((edge) => edge.fields.to), ...(plan.capabilities.get(id)?.fields.dependsOn ?? [])];
}

export function withDependsOn(plan: Plan, capability: SchemaRecord<"capability">): SchemaRecord<"capability"> {
  const edges = edgesFrom(plan, capability.id);
  if (edges.length === 0 && capability.fields.dependsOn === undefined) return capability;
  return { ...capability, fields: { ...capability.fields, dependsOn: dependsOnOf(plan, capability.id) } };
}

export function holdsContracts(plan: Plan, edge: string): boolean {
  return plan.contracts.some((contract) => contract.fields.edge === edge);
}

export function storyOfEdge(plan: Plan, edge: SchemaRecord<"edge"> | undefined): string | undefined {
  return edge === undefined ? undefined : plan.capabilities.get(edge.fields.from)?.fields.story;
}

export function storyOfContract(plan: Plan, fields: { readonly capability?: string | undefined; readonly edge?: string | undefined }): string | undefined {
  if (fields.capability !== undefined) return plan.capabilities.get(fields.capability)?.fields.story;
  return storyOfEdge(plan, plan.edges.find((edge) => edge.id === fields.edge));
}

export function prefixOf(plan: Plan, fields: { readonly capability?: string | undefined; readonly edge?: string | undefined }): number | undefined {
  const owner = fields.capability ?? plan.edges.find((edge) => edge.id === fields.edge)?.fields.from;
  const capability = owner === undefined ? undefined : plan.capabilities.get(owner);
  return capability === undefined ? undefined : capabilityNumber(capability.fields.title);
}

export function contractsOfStory(plan: Plan, story: string | undefined, except?: string): SchemaRecord<"contract">[] {
  return plan.contracts.filter((contract) => contract.id !== except && storyOfContract(plan, contract.fields) === story);
}

export function nextContract(plan: Plan, story: string | undefined, prefix: number, except: string | undefined, tested: readonly string[] = []): number {
  const numbers: (ContractNumber | undefined)[] = [
    ...contractsOfStory(plan, story, except).map((contract) => contractNumber(contract.fields.title)),
    ...tested.map(testedNumber),
  ];
  return Math.max(0, ...numbers.flatMap((number) => (number?.capability === prefix ? [number.contract] : []))) + 1;
}
