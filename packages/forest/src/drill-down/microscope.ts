// Capability 4 · Drill-down
import type { CapabilityStatus, CodeEdge, FileImport, SurveyedFile, SurveyedPart } from "@storytree/library";

export type ScopeChild = { readonly id: string; readonly title: string; readonly lines: number; readonly opens?: string; readonly word?: CapabilityStatus; readonly parked?: true };
export type ScopeGate = { readonly name: string; readonly reaches: readonly string[] };
export type ScopeLevel = {
  readonly id: string;
  readonly path: readonly string[];
  readonly titles: readonly string[];
  readonly word?: CapabilityStatus;
  readonly parked?: true;
  readonly children: readonly ScopeChild[];
  readonly roads: readonly { readonly from: string; readonly to: string }[];
  readonly gates: readonly ScopeGate[];
};
export type Microscope = { readonly story: string; readonly levels: Readonly<Record<string, ScopeLevel>> };

export type ScopeSurvey = {
  readonly files: readonly Pick<SurveyedFile, "path" | "lines" | "capability">[];
  readonly imports?: readonly FileImport[];
  readonly edges?: readonly CodeEdge[];
  readonly parts?: { readonly capabilities: Readonly<Record<string, readonly SurveyedPart[]>> };
};

export type ScopePlan = {
  readonly story: string;
  readonly title: string;
  readonly capabilities: readonly { readonly id: string; readonly title: string; readonly status: CapabilityStatus; readonly parked?: boolean }[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly names: ReadonlyMap<string, string>;
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (folder: string): string => folder.slice(folder.lastIndexOf("/") + 1);
const filesOf = (part: SurveyedPart): string[] => [...part.files, ...part.parts.flatMap(filesOf)];
const pairs = (keys: Iterable<string>) => [...new Set(keys)].sort(byText).map((key) => { const [from, to] = key.split("\n") as [string, string]; return { from, to }; });

type Node = { readonly id: string; readonly title: string; readonly own: readonly string[]; readonly parts: readonly SurveyedPart[]; readonly all: ReadonlySet<string> };
const partNode = (part: SurveyedPart): Node => ({ id: part.folder, title: nameOf(part.folder), own: part.files, parts: part.parts, all: new Set(filesOf(part)) });
const childrenOf = (node: Node): Node[] => [
  ...[...node.parts].sort((a, b) => byText(a.folder, b.folder)).map(partNode),
  ...(node.own.length === 0 ? [] : [{ id: node.id, title: node.title, own: node.own, parts: [], all: new Set(node.own) }]),
];
const opens = (node: Node): boolean => node.parts.length + (node.own.length === 0 ? 0 : 1) >= 2;

export function microscope(plan: ScopePlan, surveys: Readonly<Record<string, ScopeSurvey>>): Microscope {
  const { story } = plan;
  const survey = surveys[story];
  const lines = new Map((survey?.files ?? []).map((file) => [file.path, file.lines]));
  const sum = (files: Iterable<string>) => Math.max(1, [...files].reduce((total, file) => total + (lines.get(file) ?? 0), 0));
  const levels: Record<string, ScopeLevel> = {};
  const title = (id: string) => plan.names.get(id) ?? id;

  const edges: { from: string; to: string; files: CodeEdge["files"] }[] = [];
  const storyOf = new Map<string, string>();
  for (const edge of survey?.edges ?? []) if (edge.from !== undefined && edge.to !== undefined && edge.from !== edge.to) {
    edges.push({ from: edge.from, to: edge.to, files: edge.files });
    if (edge.story !== story) storyOf.set(edge.to, edge.story);
  }
  for (const [other, theirs] of Object.entries(surveys)) if (other !== story) for (const edge of theirs.edges ?? []) {
    if (edge.story !== story || edge.from === undefined || edge.to === undefined) continue;
    edges.push({ from: edge.from, to: edge.to, files: edge.files });
    storyOf.set(edge.from, other);
  }
  const mine = new Set(plan.capabilities.map(({ id }) => id));
  const neighbour = (capability: string): string => {
    const other = storyOf.get(capability);
    return other === undefined || other === story ? title(capability) : title(other);
  };

  const capabilityNodes = new Map(plan.capabilities.map(({ id, title: name }): [string, Node] => {
    const parts = survey?.parts?.capabilities[id] ?? [];
    const inParts = new Set(parts.flatMap(filesOf));
    const all = (survey?.files ?? []).filter((file) => file.capability === id).map((file) => file.path);
    return [id, { id, title: name, own: all.filter((file) => !inParts.has(file)), parts, all: new Set(all) }];
  }));
  const storyGates = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    const [inner, outer] = mine.has(from) && !mine.has(to) ? [from, to] : mine.has(to) && !mine.has(from) ? [to, from] : [undefined, undefined];
    if (inner === undefined || outer === undefined) continue;
    const name = title(storyOf.get(outer) ?? outer);
    storyGates.set(name, (storyGates.get(name) ?? new Set()).add(inner));
  }
  levels[story] = {
    id: story,
    path: [story],
    titles: [plan.title],
    children: plan.capabilities.map(({ id, title: name, status, parked }) => ({ id, title: name, lines: sum(capabilityNodes.get(id)!.all), opens: id, word: status, ...(parked === true ? { parked: true as const } : {}) })),
    roads: pairs([...plan.edges, ...edges].filter(({ from, to }) => mine.has(from) && mine.has(to) && from !== to).map(({ from, to }) => `${from}\n${to}`)),
    gates: gatesFrom(storyGates),
  };

  const fileCapability = new Map((survey?.files ?? []).flatMap((file) => (file.capability === undefined ? [] : [[file.path, file.capability] as const])));
  for (const capability of plan.capabilities) {
    const levelOf = (node: Node) => node.id === capability.id ? node.id : `${capability.id}:${node.id}`;
    const visit = (at: Node, ancestors: readonly Node[]): void => {
      const children = childrenOf(at);
      const childOf = new Map<string, string>();
      for (const child of children) for (const file of child.all) childOf.set(file, child.id);
      const roads: string[] = [];
      for (const { from, to } of survey?.imports ?? []) {
        const [a, b] = [childOf.get(from), childOf.get(to)];
        if (a !== undefined && b !== undefined && a !== b) roads.push(`${a}\n${b}`);
      }
      const gates = new Map<string, Set<string>>();
      const reach = (name: string, file: string | undefined) => {
        const child = file === undefined ? undefined : childOf.get(file);
        if (child !== undefined) gates.set(name, (gates.get(name) ?? new Set()).add(child));
      };
      const beside = (file: string): string | undefined => {
        const up = [...ancestors].reverse().find((node) => node.all.has(file));
        return up === undefined ? undefined : childrenOf(up).find((child) => child.all.has(file))?.title;
      };
      if (ancestors.length > 0) for (const { from, to } of survey?.imports ?? []) {
        if (at.all.has(from) === at.all.has(to)) continue;
        const [inside, outside] = at.all.has(from) ? [from, to] : [to, from];
        const name = fileCapability.get(outside) === capability.id ? beside(outside) : undefined;
        if (name !== undefined) reach(name, inside);
      }
      for (const edge of edges) {
        if (edge.from === capability.id) for (const file of edge.files) reach(neighbour(edge.to), file.from);
        if (edge.to === capability.id) for (const file of edge.files) reach(neighbour(edge.from), file.to);
      }
      if (ancestors.length === 0) for (const { from, to } of plan.edges) {
        const other = from === capability.id ? to : to === capability.id ? from : undefined;
        if (other !== undefined && other !== capability.id && !gates.has(neighbour(other))) gates.set(neighbour(other), new Set());
      }
      levels[levelOf(at)] = {
        id: levelOf(at),
        path: [story, ...ancestors.map(levelOf), levelOf(at)],
        titles: [plan.title, ...ancestors.map(({ title: name }) => name), at.title],
        word: capability.status,
        ...(capability.parked === true ? { parked: true as const } : {}),
        children: children.map((child) => ({ id: child.id, title: child.title, lines: sum(child.all), ...(child.id !== at.id && opens(child) ? { opens: levelOf(child) } : {}) })),
        roads: pairs(roads),
        gates: gatesFrom(gates),
      };
      for (const child of children) if (child.id !== at.id && opens(child)) visit(child, [...ancestors, at]);
    };
    visit(capabilityNodes.get(capability.id)!, []);
  }
  return { story, levels };
}

function gatesFrom(gates: ReadonlyMap<string, ReadonlySet<string>>): ScopeGate[] {
  return [...gates].map(([name, reaches]) => ({ name, reaches: [...reaches].sort(byText) })).sort((a, b) => byText(a.name, b.name));
}
