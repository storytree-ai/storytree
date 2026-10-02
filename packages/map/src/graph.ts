/** Capability 1 · Joined graph: dependencies point from the dependent to its prerequisite. */
import type { AnnotatedTree, NodeHealth } from "@storytree/library";
import { packageOf } from "./code-survey/code-survey.js";
import type { ProjectSurvey } from "./code-survey/read-survey.js";

export type NodeKind = "story" | "capability" | "promise" | "file" | "test";
export type MapHealth = "healthy" | "failing" | "untested";
export interface MapNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly health: MapHealth;
  readonly story: string;
  readonly number?: string;
  readonly path?: string;
}
export interface MapEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "belongs-to" | "depends-on" | "implements" | "imports" | "tests";
  readonly provenance: "declared" | "inferred";
}
export interface ProjectGraph {
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  readonly healthSource: "verified" | "reported";
}

/** Repository paths use forward slashes on every platform, including selectors supplied by Windows callers. */
export function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function healthOf(health: NodeHealth | undefined, source: "verified" | "reported"): MapHealth {
  const state = health?.[source].state;
  return state === "passing" ? "healthy" : state === "failing" ? "failing" : "untested";
}

/** Join the owning library and survey's readings; this function reads neither store itself. */
export function buildGraph(tree: AnnotatedTree, survey: ProjectSurvey): ProjectGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const healthSource = tree.unverified ? "reported" : "verified";
  const add = (node: MapNode): void => { nodes.set(node.id, node); };
  const edge = (from: string, to: string, kind: MapEdge["kind"], provenance: MapEdge["provenance"]): void => {
    const value = { from, to, kind, provenance };
    edges.set(JSON.stringify(value), value);
  };
  for (const story of tree.stories) {
    add({ id: story.id, kind: "story", title: story.title, story: story.id, health: healthOf(story.health, healthSource) });
    for (const cap of story.capabilities) {
      const number = /^\s*(\d+)\s*·/.exec(cap.title)?.[1];
      add({ id: cap.id, kind: "capability", title: cap.title, story: story.id, health: healthOf(cap.health, healthSource), ...(number === undefined ? {} : { number }) });
      edge(cap.id, story.id, "belongs-to", "declared");
      for (const dependency of cap.dependsOn) edge(cap.id, dependency, "depends-on", "declared");
      for (const contract of cap.contracts) {
        const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
        add({ id: contract.id, kind: "promise", title: contract.title, story: story.id, health: healthOf(contract.health, healthSource), ...(number === undefined ? {} : { number }) });
        edge(contract.id, cap.id, "belongs-to", "declared");
      }
    }
  }
  for (const story of tree.stories) {
    const read = survey[story.id];
    if (!read) continue;
    const pathname = (file: string): string => normalizePath(`packages/${packageOf(story.title)}/${file}`);
    const fileId = (file: string): string => `${read.tests?.some(test => test.path === file) ? "test" : "file"}:${pathname(file)}`;
    const caps = new Map(story.capabilities.map(cap => [cap.id, cap]));
    const promises = new Map(story.capabilities.flatMap(cap => cap.contracts.flatMap(contract => {
      const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
      return number === undefined ? [] : [[number, contract] as const];
    })));
    for (const file of read.files) {
      const cap = file.capability === undefined ? undefined : caps.get(file.capability);
      add({ id: fileId(file.path), kind: "file", title: pathname(file.path), path: pathname(file.path), story: story.id, health: healthOf(cap?.health, healthSource) });
      if (cap) {
        edge(fileId(file.path), cap.id, "implements", "inferred");
        // These direct edges make a file's promises visible at depth one (Projects 2.5).
        for (const contract of cap.contracts) edge(fileId(file.path), contract.id, "implements", "inferred");
      }
    }
    for (const file of read.tests ?? []) {
      const contracts = file.titles.flatMap(title => { const contract = promises.get(title.number); return contract ? [contract] : []; });
      const states = contracts.map(contract => healthOf(contract.health, healthSource));
      const health = states.includes("failing") ? "failing" : states.length > 0 && states.every(state => state === "healthy") ? "healthy" : "untested";
      add({ id: fileId(file.path), kind: "test", title: pathname(file.path), path: pathname(file.path), story: story.id, health });
      for (const contract of contracts) edge(fileId(file.path), contract.id, "tests", "inferred");
      for (const imported of file.imports) {
        edge(fileId(imported.from), fileId(imported.to), "imports", "inferred");
        for (const contract of contracts) edge(fileId(imported.to), contract.id, "implements", "inferred");
      }
    }
    for (const imported of read.imports) edge(fileId(imported.from), fileId(imported.to), "imports", "inferred");
    for (const dependency of read.dependsOn ?? []) edge(story.id, dependency, "depends-on", "inferred");
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter(edge => nodes.has(edge.from) && nodes.has(edge.to)), healthSource };
}
