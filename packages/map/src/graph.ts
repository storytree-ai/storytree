/** Capability 1 · Joined graph: dependencies point from the dependent to its prerequisite. */
import type { AnnotatedTree, NodeHealth, SurveyedTest } from "@storytree/library";

import { packageOf, packagesOf } from "./code-survey/code-survey.js";
import type { ProjectSurvey } from "./code-survey/read-survey.js";

export type SnapshotOrigin = "base" | "target" | "both";
export type ChangeLabel = "added" | "modified" | "deleted" | "renamed-from" | "renamed-to" | "untracked";
export type NodeKind = "story" | "capability" | "contract" | "file" | "test";
export type MapHealth = "healthy" | "failing" | "untested";
export interface MapNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  /** A mapped story and its files read mapped, in place of a health they do not carry (ADR-0993 D3). */
  readonly health: MapHealth | "mapped";
  /** A mapped story in a loop of roads among mapped stories: the titles round it, its own first. */
  readonly loop?: readonly string[];
  readonly story: string;
  readonly number?: string;
  readonly path?: string;
  /** Proof identities retain their package qualifier when a dependent tests another story. */
  readonly testTitles?: SurveyedTest["titles"];
  /**
   * A contract no numbered test of its story's packages proves: each test in a dependent story's package titled with its
   * number and no prefix, which credits that package's own story (ADR-0649), and the prefix that would credit this one.
   */
  readonly elsewhere?: readonly { readonly path: string; readonly title: string; readonly prefix: string }[];
  readonly snapshot?: SnapshotOrigin;
  readonly changes?: readonly ChangeLabel[];
  readonly unresolved?: string;
  /** A contract on an edge (ADR-1282 D1): the edge, and its capabilities, `from` depending on `to`. */
  readonly onEdge?: { readonly id: string; readonly from: string; readonly to: string };
}
export interface MapEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "belongs-to" | "depends-on" | "implements" | "imports" | "tests";
  readonly provenance: "declared" | "inferred";
  readonly snapshot?: SnapshotOrigin;
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

/** What a contract's reading says of a test numbered for it in another story's package (ADR-0649), and how to credit it. */
export function elsewhereSaid(test: NonNullable<MapNode["elsewhere"]>[number]): string {
  return `not credited: test ${JSON.stringify(test.title)} in ${test.path} sits in another story's package, which credits its own story's contracts (ADR-0649): move it to this story's package or prefix its title with ${test.prefix}`;
}

/** Join the owning library and survey's readings; this function reads neither store itself. */
export function buildGraph(tree: AnnotatedTree, survey: ProjectSurvey): ProjectGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const healthSource = tree.unverified ? "reported" : "verified";
  // A prefixed title names a package, and every package a story owns holds its promises (ADR-1066 D3).
  const promisesByPackage = new Map(tree.stories.filter(story => story.mapped === undefined).flatMap(story => {
    const promises = new Map(story.capabilities.flatMap(cap => cap.contracts.flatMap(contract => {
      const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
      return number === undefined ? [] : [[number, contract] as const];
    })));
    return packagesOf(story).map(name => [name, promises] as const);
  }));
  const add = (node: MapNode): void => { nodes.set(node.id, node); };
  const edge = (from: string, to: string, kind: MapEdge["kind"], provenance: MapEdge["provenance"]): void => {
    const value = { from, to, kind, provenance };
    edges.set(JSON.stringify(value), value);
  };
  const titleOf = new Map(tree.stories.map(story => [story.id, story.title]));
  for (const story of tree.stories) {
    const loop = survey[story.id]?.mapped?.loop?.map(id => titleOf.get(id) ?? id);
    add({ id: story.id, kind: "story", title: story.title, story: story.id, health: story.mapped === undefined ? healthOf(story.health, healthSource) : "mapped", ...(loop === undefined ? {} : { loop }) });
    for (const cap of story.capabilities) {
      const number = /^\s*(\d+)\s*·/.exec(cap.title)?.[1];
      // An explored capability of a mapped story reads by its own health, untested (proposed) with no tests tied, as the
      // forest draws it; only the story and its unexplored files stay mapped (ADR-0993 D3 as narrowed by question_7e73e1c75c0d).
      add({ id: cap.id, kind: "capability", title: cap.title, story: story.id, health: healthOf(cap.health, healthSource), ...(number === undefined ? {} : { number }) });
      edge(cap.id, story.id, "belongs-to", "declared");
      for (const dependency of cap.dependsOn) edge(cap.id, dependency, "depends-on", "declared");
      for (const contract of cap.contracts) {
        const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
        add({ id: contract.id, kind: "contract", title: contract.title, story: story.id, health: healthOf(contract.health, healthSource), ...(number === undefined ? {} : { number }) });
        edge(contract.id, cap.id, "belongs-to", "declared");
      }
    }
    // An edge's contract belongs to both capabilities it joins, so a focus on either lists it beside its own.
    for (const link of story.edges ?? []) {
      for (const contract of link.contracts) {
        const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
        add({ id: contract.id, kind: "contract", title: contract.title, story: story.id, health: healthOf(contract.health, healthSource), onEdge: { id: link.id, from: link.from, to: link.to }, ...(number === undefined ? {} : { number }) });
        edge(contract.id, link.from, "belongs-to", "declared");
        edge(contract.id, link.to, "belongs-to", "declared");
      }
    }
  }
  for (const story of tree.stories) {
    const read = survey[story.id];
    if (!read) continue;
    if (read.mapped !== undefined) {
      // A mapped island is a black box (ADR-0993 D5): its files, each in the capability an agent explored that covers it
      // or in none, and its roads; its files' ids are their full paths.
      for (const file of read.files) {
        const id = `file:${`${read.mapped.folder.replaceAll("\\", "/").replace(/\/$/, "")}/${file.path}`}`;
        add({ id, kind: "file", title: file.path, path: file.path, story: story.id, health: "mapped" });
        edge(id, story.id, "belongs-to", "inferred");
        if (file.capability !== undefined) edge(id, file.capability, "implements", "declared");
      }
      for (const dependency of read.dependsOn ?? []) edge(story.id, dependency, "depends-on", "inferred");
      continue;
    }
    const ownPackage = packageOf(story);
    const pathname = (file: string): string => normalizePath(`packages/${ownPackage}/${file}`);
    const fileId = (file: string): string => `${read.tests?.some(test => test.path === file) ? "test" : "file"}:${pathname(file)}`;
    const caps = new Map(story.capabilities.map(cap => [cap.id, cap]));
    for (const file of read.files) {
      const cap = file.capability === undefined ? undefined : caps.get(file.capability);
      add({ id: fileId(file.path), kind: "file", title: pathname(file.path), path: pathname(file.path), story: story.id, health: healthOf(cap?.health, healthSource) });
      edge(fileId(file.path), story.id, "belongs-to", "inferred");
      if (cap) {
        edge(fileId(file.path), cap.id, "implements", "inferred");
        // These direct edges make a file's promises visible at depth one (Projects 2.5).
        for (const contract of cap.contracts) edge(fileId(file.path), contract.id, "implements", "inferred");
      }
    }
    for (const file of read.tests ?? []) {
      const contracts = file.titles.flatMap(title => { const contract = promisesByPackage.get(title.package ?? ownPackage)?.get(title.number); return contract ? [contract] : []; });
      const states = contracts.map(contract => healthOf(contract.health, healthSource));
      const health = states.includes("failing") ? "failing" : states.length > 0 && states.every(state => state === "healthy") ? "healthy" : "untested";
      add({ id: fileId(file.path), kind: "test", title: pathname(file.path), path: pathname(file.path), story: story.id, health, testTitles: file.titles });
      edge(fileId(file.path), story.id, "belongs-to", "inferred");
      for (const contract of contracts) edge(fileId(file.path), contract.id, "tests", "inferred");
      for (const imported of file.imports) {
        edge(fileId(imported.from), fileId(imported.to), "imports", "inferred");
        for (const contract of contracts) edge(fileId(imported.to), contract.id, "implements", "inferred");
      }
    }
    for (const imported of read.imports) edge(fileId(imported.from), fileId(imported.to), "imports", "inferred");
    for (const dependency of read.dependsOn ?? []) edge(story.id, dependency, "depends-on", "inferred");
  }
  // A test numbered for a contract but sitting in a dependent's package credits nothing here, so the contract says where it is.
  const proven = new Set([...edges.values()].filter(edge => edge.kind === "tests").map(edge => edge.to));
  for (const story of tree.stories) {
    const read = survey[story.id];
    if (story.mapped !== undefined || !read?.tests) continue;
    for (const home of tree.stories.filter(other => other.id !== story.id && other.mapped === undefined && read.dependsOn?.includes(other.id))) {
      for (const contract of home.capabilities.flatMap(cap => cap.contracts)) {
        const node = nodes.get(contract.id);
        if (node?.number === undefined || proven.has(contract.id)) continue;
        const found = read.tests.flatMap(file => file.titles.filter(title => title.package === undefined && title.number === node.number)
          .map(title => ({ path: normalizePath(`packages/${packageOf(story)}/${file.path}`), title: title.title, prefix: packageOf(home) })));
        if (found.length > 0) nodes.set(contract.id, { ...node, elsewhere: [...node.elsewhere ?? [], ...found] });
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter(edge => nodes.has(edge.from) && nodes.has(edge.to)), healthSource };
}
