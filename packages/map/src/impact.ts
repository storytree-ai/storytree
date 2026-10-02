/** Capability 4 · A change reaches its owners and their dependents without crossing story containers. */
import { focusRows, mapDepth, type FocusAnswer, type FocusOptions, type FocusRow } from "./focus.js";
import type { MapEdge, ProjectGraph } from "./graph.js";

export function impact(graph: ProjectGraph, selected: readonly string[], label: string, options: Omit<FocusOptions, "select">): FocusAnswer {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, MapEdge[]>();
  const incoming = new Map<string, MapEdge[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.from, [...outgoing.get(edge.from) ?? [], edge]);
    incoming.set(edge.to, [...incoming.get(edge.to) ?? [], edge]);
  }
  const rows = new Map<string, FocusRow>();
  for (const id of selected) { const node = byId.get(id); if (node) rows.set(id, { ...node, depth: 0, edge: [] }); }
  const down = mapDepth(options.down, options.up === undefined ? graph.nodes.length : 0);
  const up = mapDepth(options.up, 0);
  for (const [direction, limit] of [["impact", down], ["up", up]] as const) {
    const visited = new Set(selected);
    const queue = selected.map(id => ({ id, depth: 0 }));
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      if (current.depth >= limit) continue;
      const forward = (outgoing.get(current.id) ?? []).filter(edge => direction === "up" || edge.kind === "implements" || edge.kind === "tests" || (edge.kind === "belongs-to" && byId.get(edge.from)?.kind === "promise" && byId.get(edge.to)?.kind === "capability"));
      const reverse = direction === "up" ? [] : (incoming.get(current.id) ?? []).filter(edge => ["imports", "implements", "tests", "depends-on"].includes(edge.kind) || (edge.kind === "belongs-to" && byId.get(edge.from)?.kind === "promise" && byId.get(edge.to)?.kind === "capability"));
      for (const [edge, id] of [...forward.map(edge => [edge, edge.to] as const), ...reverse.map(edge => [edge, edge.from] as const)]) {
        const node = byId.get(id);
        if (!node || (direction === "impact" && node.kind === "story")) continue;
        const depth = current.depth + 1;
        const prior = rows.get(id);
        if (!prior || depth < prior.depth) rows.set(id, { ...node, depth, edge: [edge] });
        else if (depth === prior.depth && !prior.edge.includes(edge)) rows.set(id, { ...prior, edge: [...prior.edge, edge] });
        if (!visited.has(id)) { visited.add(id); queue.push({ id, depth }); }
      }
    }
  }
  return focusRows(graph, [label], [...rows.values()], options);
}
