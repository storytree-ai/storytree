// Capability 4 · Work model
import type { FieldsOf, SchemaRecord } from "../storage/rules/index.js";
import { dependsOnOf, storyOfEdge, type Plan } from "./snapshot.js";

export const ANCHOR_ID = "project-anchor";

export type Anchor = FieldsOf<"anchor">;
type Guardrail = NonNullable<FieldsOf<"story">["guardrails"]>[number];
export type StoreLink = NonNullable<FieldsOf<"capability">["storeLinks"]>[number];
type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;

export interface ProjectTree {
  anchor?: Anchor;
  stories: StoryNode[];
  arcs: ArcNode[];
}

export interface StoryNode {
  id: string;
  title: string;
  description?: string;
  mapped?: { from: string; package: string; folders: string[] };
  folders?: string[];
  plugin?: string;
  risk?: NonNullable<FieldsOf<"story">["risk"]>;
  guardrails?: Guardrail[];
  capabilities: CapabilityNode[];
  edges?: EdgeNode[];
}

export interface EdgeNode {
  id: string;
  from: string;
  to: string;
  description?: string;
  contracts: ContractNode[];
}

export interface CapabilityNode {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  proposed: boolean;
  parent?: string;
  covers?: string[];
  storeLinks?: StoreLink[];
  guardrails?: Guardrail[];
  contracts: ContractNode[];
}

export interface ContractNode {
  id: string;
  title: string;
  description?: string;
  provedBy?: string[];
  proof?: ContractProof;
}

export interface ArcNode {
  id: string;
  title: string;
  description?: string;
  stories: string[];
}

export interface AnchorGaps {
  anchor: ("what" | "audience")[];
}

export function anchorGaps(tree: { anchor?: Anchor | undefined }): AnchorGaps {
  return { anchor: (["what", "audience"] as const).filter((half) => tree.anchor?.[half] === undefined) };
}

export function treeOf(plan: Plan, arcs: readonly SchemaRecord<"arc">[], anchor: Anchor | undefined): ProjectTree {
  const contracts = (owner: (contract: SchemaRecord<"contract">) => boolean): ContractNode[] =>
    plan.contracts.filter(owner).map(({ id, fields }) => ({ id, title: fields.title, ...defined(fields, ["description", "provedBy", "proof"]) }) as ContractNode);
  const stories = [...plan.stories.values()].map((story): StoryNode => {
    const capabilities = [...plan.capabilities.values()].filter((capability) => capability.fields.story === story.id);
    const edges = plan.edges.filter((edge) => storyOfEdge(plan, edge) === story.id);
    return {
      id: story.id,
      title: story.fields.title,
      ...defined(story.fields, ["description", "mapped", "folders", "plugin", "risk", "guardrails"]),
      capabilities: capabilities.map(({ id, fields }) => ({
        id,
        title: fields.title,
        ...defined(fields, ["description"]),
        dependsOn: dependsOnOf(plan, id),
        proposed: fields.proposed,
        ...defined(fields, ["parent", "covers", "storeLinks", "guardrails"]),
        contracts: contracts((contract) => contract.fields.capability === id),
      }) as CapabilityNode),
      ...(edges.length === 0 ? {} : {
        edges: edges.map(({ id, fields }) => ({ id, from: fields.from, to: fields.to, ...defined(fields, ["description"]), contracts: contracts((contract) => contract.fields.edge === id) }) as EdgeNode),
      }),
    } as StoryNode;
  });
  return {
    ...(anchor === undefined ? {} : { anchor }),
    stories,
    arcs: arcs.map(({ id, fields }) => ({ id, title: fields.title, ...defined(fields, ["description"]), stories: fields.stories ?? [] }) as ArcNode),
  };
}

function defined<T extends object>(fields: T, keys: readonly (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.flatMap((key) => (fields[key] === undefined ? [] : [[key, fields[key]]]))) as Partial<T>;
}
