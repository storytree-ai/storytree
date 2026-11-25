// Capability 5 · Capability tree scorecard
import { VerbRefusal } from "@storytree/library/verbs";

import type { Refactor } from "./tree-refactor.js";

export interface TreeNode {
  readonly id: string;
  readonly title: string;
  readonly parent?: string;
  readonly entry?: string;
}

export interface Tree {
  readonly nodes: readonly TreeNode[];
  readonly ownerOf: Readonly<Record<string, string>>;
  readonly unplaced: readonly string[];
}

export interface ProposedNode {
  readonly id: string;
  readonly title: string;
  readonly parent?: string;
  readonly entry?: string;
  readonly files?: readonly string[];
  readonly capabilities?: readonly number[];
}

const numberOf = (title: string): number | undefined => {
  const found = /^\s*(\d+)\s*·/.exec(title);
  return found === null ? undefined : Number(found[1]);
};

const nodeOf = ({ id, title, parent, entry }: TreeNode): TreeNode => ({ id, title, ...(parent === undefined ? {} : { parent }), ...(entry === undefined ? {} : { entry }) });

export function planTreeOf(capabilities: readonly TreeNode[], files: readonly { path: string; capability?: string }[]): Tree {
  const ownerOf: Record<string, string> = {};
  const unplaced: string[] = [];
  for (const { path, capability } of files) {
    if (capability === undefined) unplaced.push(path);
    else ownerOf[path] = capability;
  }
  return { nodes: capabilities.map(nodeOf), ownerOf, unplaced };
}

export function proposedTreeOf(proposal: { readonly nodes: readonly ProposedNode[] } & Refactor, plan: Tree): Tree {
  const splits = proposal.splits ?? [];
  const gone = new Set(splits.filter(({ file, into }) => !Object.hasOwn(into, file)).map(({ file }) => file));
  const byNumber = new Map<number, string[]>();
  for (const [path, capability] of Object.entries(plan.ownerOf)) {
    const node = plan.nodes.find(({ id }) => id === capability);
    const number = node === undefined ? undefined : numberOf(node.title);
    if (number !== undefined) byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  const ownerOf: Record<string, string> = {};
  for (const node of proposal.nodes) {
    const taken = new Set([...(node.files ?? []), ...(node.capabilities ?? []).flatMap((number) => byNumber.get(number) ?? [])].filter((path) => !gone.has(path)));
    for (const path of taken) {
      const was = ownerOf[path];
      if (was !== undefined) throw new VerbRefusal(`The proposed tree gives ${path} to two nodes, ${was} and ${node.id}: give each file to one node.`);
      ownerOf[path] = node.id;
    }
  }
  const storyFiles = new Set([...Object.keys(plan.ownerOf), ...plan.unplaced, ...splits.flatMap(({ into }) => Object.keys(into)), ...(proposal.retargets ?? []).flatMap(({ to }) => (to === undefined ? [] : [to]))]);
  return { nodes: proposal.nodes.map(nodeOf), ownerOf, unplaced: [...storyFiles].filter((path) => !gone.has(path) && ownerOf[path] === undefined) };
}
