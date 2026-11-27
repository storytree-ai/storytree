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

export type SurveyedFile = {
  readonly path: string;
  readonly lines: number;
  readonly capability?: string;
  readonly declared?: number;
  readonly reachedBy?: readonly number[];
};
export type FileImport = {
  readonly from: string;
  readonly to: string;
};
export type SurveyedTest = {
  readonly kind: "test";
  readonly path: string;
  readonly titles: readonly {
      readonly number: string;
      readonly title: string;
      readonly package?: string;
  }[];
  readonly imports: readonly FileImport[];
};
export type EdgeFile = {
  readonly from: string;
  readonly to?: string;
  readonly typeOnly: boolean;
  readonly forwarder?: true;
  readonly plumbing?: "build step" | "cleanup";
};
export type CodeEdge = {
  readonly story: string;
  readonly from?: string;
  readonly to?: string;
  readonly typeOnly: boolean;
  readonly files: readonly EdgeFile[];
};
export type SurveyedPart = {
  readonly folder: string;
  readonly entry?: string;
  readonly files: readonly string[];
  readonly parts: readonly SurveyedPart[];
};
export type PartClash = {
  readonly from: string;
  readonly to: string;
  readonly part: string;
  readonly enters: readonly string[];
  readonly around: readonly string[];
  readonly suggestion: string;
};
export type SurveyedParts = {
  readonly capabilities: Readonly<Record<string, readonly SurveyedPart[]>>;
  readonly clashes: readonly PartClash[];
};
export type StorySurvey = {
  readonly files: readonly SurveyedFile[];
  readonly imports: readonly FileImport[];
  readonly tests?: readonly SurveyedTest[];
  readonly edges?: readonly CodeEdge[];
  readonly dependsOn?: readonly string[];
  readonly parts?: SurveyedParts;
  readonly mapped?: {
      readonly folder: string;
      readonly loop?: readonly string[];
  };
};
export type StoreTable = {
  readonly name: string;
};
export type SharedStore = {
  readonly address: string;
  readonly medium: string;
  readonly tables: readonly StoreTable[];
};
