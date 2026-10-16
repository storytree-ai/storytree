/** Capability 2 · Focus selection. Capabilities 2 and 3 · Focus selection and counts before detail. */
import { normalizePath, type ChangeLabel, type MapEdge, type MapHealth, type MapNode, type NodeKind, type ProjectGraph } from "./graph.js";

export type FocusMode = "counts" | "dry_run" | "show";
export interface FocusOptions {
  readonly select: string;
  readonly up?: number;
  readonly down?: number;
  readonly kind?: readonly NodeKind[];
  readonly mode?: FocusMode;
}
export interface FocusRow extends MapNode {
  readonly depth: number;
  readonly edge: readonly MapEdge[];
}
export interface DiffSummary {
  readonly range: string;
  readonly base: string;
  readonly target: string;
  readonly comparison: "working-tree" | "commits" | "merge-base";
  readonly changedPaths: number;
  readonly renames: number;
  readonly unresolved: number;
  readonly statuses: Partial<Record<ChangeLabel, number>>;
  readonly notes: readonly string[];
}
export interface FocusAnswer {
  readonly mode: FocusMode;
  readonly selected: readonly string[];
  readonly rowCount: number;
  readonly estimatedTokens: number;
  readonly healthSource: ProjectGraph["healthSource"];
  readonly counts: {
    readonly byDepth: Record<number, Partial<Record<NodeKind, number>>>;
    readonly byKind: Partial<Record<NodeKind, number>>;
    readonly health: Record<MapHealth, number>;
    /** Rows of mapped stories and their files, which carry no health (ADR-0993 D3). */
    readonly mapped: number;
  };
  readonly refused: boolean;
  readonly ceiling: number;
  readonly hints: readonly string[];
  /** Each loop of roads among the mapped stories shown, the titles round it; reported, refusing nothing. */
  readonly loops?: readonly (readonly string[])[];
  readonly rows?: readonly FocusRow[];
  readonly diff?: DiffSummary;
}

export const SHOW_CEILING = 200;
const KINDS: readonly NodeKind[] = ["story", "capability", "promise", "file", "test"];

/** Whether a repository path is on disk in the checkout the map was read from; the map's graph cannot say. */
export type OnDisk = (path: string) => boolean;

/**
 * Why a file the map has no node for is refused, and what to select instead. Such a file is refused, not answered
 * as its story's node: an agent asking about one file would otherwise get its whole story's neighbourhood unasked.
 */
function unmappedFile(graph: ProjectGraph, select: string, wanted: string, exists: OnDisk | undefined): string {
  const files = graph.nodes.filter(node => node.kind === "file" || node.kind === "test");
  // A file or test node's id is its full repository path after a five-character "file:" or "test:".
  const full = (node: MapNode): string => normalizePath(node.id.slice(5));
  const head = `Map selection not found: ${select}`;
  if (exists?.(wanted) === false) {
    const name = wanted.split("/").at(-1);
    const moved = files.filter(node => full(node).split("/").at(-1) === name).map(node => `file:${full(node)}`);
    return `${head}: no such file is on disk in this checkout (moved, deleted, or only on another branch).${moved.length === 0 ? "" : ` Did you mean ${moved.join(", ")}?`}`;
  }
  const folders = wanted.split("/").slice(0, -1);
  const shared = (node: MapNode): number => {
    const parts = full(node).split("/");
    let at = 0;
    while (at < folders.length && at < parts.length - 1 && parts[at] === folders[at]) at++;
    return at;
  };
  // A story holds the file when its own files share at least the file's package folder (packages/<name>, apps/<name>).
  const best = Math.max(2, ...files.map(shared));
  const owners = [...new Set(files.filter(node => shared(node) === best).map(node => node.story))]
    .flatMap(id => graph.nodes.filter(node => node.kind === "story" && node.id === id));
  const why = exists === undefined ? "the map carries only the source and test files the code survey reads" : "it is on disk, but it is not a source or test file the code survey reads, and the map carries only those";
  return `${head}: ${why}. ${owners.length === 0 ? "No story's package holds it." : `It is in the package of ${owners.map(story => `story:${story.id} (${story.title})`).join(", ")}: select that instead.`}`;
}

/** An ambiguous number is refused rather than choosing one story's identically numbered capability. */
export function selectNode(graph: ProjectGraph, select: string, exists?: OnDisk): MapNode {
  const at = select.indexOf(":");
  const prefix = select.slice(0, at);
  const wanted = select.slice(at + 1);
  if (at < 0 || !wanted || !["file", "cap", "promise", "story"].includes(prefix)) throw new Error("Select file:<path>, cap:<id|number>, promise:<id|number>, or story:<name>.");
  const found = graph.nodes.filter(node => {
    // A mapped file is also selected by its full path, which its id carries.
    if (prefix === "file") return (node.kind === "file" || node.kind === "test") && (node.path === normalizePath(wanted) || (node.health === "mapped" && normalizePath(node.id.slice(5)) === normalizePath(wanted)));
    if (prefix === "cap") return node.kind === "capability" && (node.id === wanted || node.number === wanted);
    if (prefix === "promise") return node.kind === "promise" && (node.id === wanted || node.number === wanted);
    return node.kind === "story" && (node.id === wanted || node.title.toLowerCase() === wanted.toLowerCase());
  });
  if (found.length === 0) throw new Error(prefix === "file" ? unmappedFile(graph, select, normalizePath(wanted), exists) : `Map selection not found: ${select}`);
  if (found.length > 1) throw new Error(`Ambiguous map selection ${select}; use an id: ${found.map(node => `${node.id} (${node.story})`).join(", ")}`);
  return found[0]!;
}

export function mapDepth(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Map depth must be a non-negative integer.");
  return result;
}

export function focus(graph: ProjectGraph, options: FocusOptions, limits: { ceiling?: number; exists?: OnDisk } = {}): FocusAnswer {
  return focusNodes(graph, [selectNode(graph, options.select, limits.exists).id], options, limits);
}

/** Shared traversal for one focused node or the changed nodes of a diff. Filters never block traversal. */
export function focusNodes(graph: ProjectGraph, selected: readonly string[], options: Omit<FocusOptions, "select">, limits: { ceiling?: number } = {}): FocusAnswer {
  const bothDefault = options.up === undefined && options.down === undefined;
  const up = mapDepth(options.up, bothDefault ? 1 : 0);
  const down = mapDepth(options.down, bothDefault ? 1 : 0);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const rows = new Map<string, { node: MapNode; depth: number; edge: MapEdge[] }>();
  for (const id of selected) { const node = byId.get(id); if (node) rows.set(id, { node, depth: 0, edge: [] }); }
  for (const [direction, limit] of [["up", up], ["down", down]] as const) {
    const adjacency = new Map<string, MapEdge[]>();
    for (const edge of graph.edges) {
      const id = direction === "up" ? edge.from : edge.to;
      const from = adjacency.get(id) ?? [];
      from.push(edge);
      adjacency.set(id, from);
    }
    const visited = new Set(selected);
    const queue = selected.map(id => ({ id, depth: 0 }));
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      if (current.depth >= limit) continue;
      for (const edge of adjacency.get(current.id) ?? []) {
        const id = direction === "up" ? edge.to : edge.from;
        const node = byId.get(id);
        if (!node) continue;
        const at = current.depth + 1;
        const previous = rows.get(id);
        if (!previous || at < previous.depth) rows.set(id, { node, depth: at, edge: [edge] });
        else if (at === previous.depth && !previous.edge.includes(edge)) previous.edge.push(edge);
        if (!visited.has(id)) { visited.add(id); queue.push({ id, depth: at }); }
      }
    }
  }
  return focusRows(graph, selected, [...rows.values()].map(({ node, depth, edge }) => ({ ...node, depth, edge })), options, limits);
}

/** One aggregation and ceiling for normal focus and diff impact. Filtering follows every walk. */
export function focusRows(graph: ProjectGraph, selected: readonly string[], rows: readonly FocusRow[], options: Omit<FocusOptions, "select">, limits: { ceiling?: number } = {}): FocusAnswer {
  const mode = options.mode ?? "counts";
  if (!["counts", "dry_run", "show"].includes(mode)) throw new Error("Map mode must be counts, dry_run or show.");
  if (options.kind?.some(kind => !KINDS.includes(kind))) throw new Error(`Map kind must be one of ${KINDS.join(", ")}.`);
  const ceiling = limits.ceiling ?? SHOW_CEILING;
  const shown = rows.filter(node => !options.kind || options.kind.includes(node.kind))
    .sort((a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const counts = { byDepth: {} as FocusAnswer["counts"]["byDepth"], byKind: {} as FocusAnswer["counts"]["byKind"], health: { healthy: 0, failing: 0, untested: 0 }, mapped: 0 };
  for (const row of shown) {
    const at = counts.byDepth[row.depth] ??= {};
    at[row.kind] = (at[row.kind] ?? 0) + 1;
    counts.byKind[row.kind] = (counts.byKind[row.kind] ?? 0) + 1;
    if (row.health === "mapped") counts.mapped++;
    else counts.health[row.health]++;
  }
  const loops = shown.flatMap(row => row.loop === undefined ? [] : [row.loop]);
  const refused = mode === "show" && shown.length > ceiling;
  return {
    mode, selected, rowCount: shown.length, estimatedTokens: Math.ceil(JSON.stringify(shown).length / 4), healthSource: graph.healthSource,
    counts, refused, ceiling,
    ...(loops.length === 0 ? {} : { loops }),
    hints: ["Narrow with a smaller --up/--down depth or --kind story,capability,promise,file,test.", "Use --dry-run to estimate, then --show for every row."],
    ...(mode === "show" && !refused ? { rows: shown } : {}),
  };
}

/** The CLI and tool share the same readable answer as well as the same JSON data. */
export function formatFocus(answer: FocusAnswer): string {
  // An answer of mapped rows alone says no health word: mapped code carries none (ADR-0993 D3).
  const health = answer.rowCount === 0 || answer.counts.mapped < answer.rowCount;
  const lines = [`${answer.rowCount} rows; approximately ${answer.estimatedTokens} tokens.${health ? ` Health: ${answer.healthSource}.` : ""}`];
  if (answer.diff) {
    lines.push(`Diff ${answer.diff.range}: ${answer.diff.comparison}; base ${answer.diff.base}; target ${answer.diff.target}. ${answer.diff.changedPaths} changed paths; ${answer.diff.renames} renames; ${answer.diff.unresolved} unresolved.`);
    lines.push(`Changes: ${Object.entries(answer.diff.statuses).map(([status, count]) => `${status} ${count}`).join(", ") || "none"}.`);
    lines.push(...answer.diff.notes);
  }
  if (answer.refused) lines.push(`Show refused: ${answer.rowCount} rows exceeds the ceiling of ${answer.ceiling}. Narrow the selection.`);
  for (const [depth, kinds] of Object.entries(answer.counts.byDepth)) lines.push(`Depth ${depth}: ${Object.entries(kinds).map(([kind, count]) => `${kind} ${count}`).join(", ")}`);
  if (health) lines.push(`Health: ${Object.entries(answer.counts.health).map(([state, count]) => `${state} ${count}`).join(", ")}`);
  if (answer.counts.mapped > 0) lines.push(`Mapped: ${answer.counts.mapped}`);
  for (const loop of answer.loops ?? []) lines.push(`Loop of roads among mapped stories, reported, refusing nothing: ${[...loop, loop[0]].join(" → ")}`);
  for (const row of answer.rows ?? []) lines.push(`${row.depth}  ${row.kind}  ${row.id}  ${row.title}  [${row.health}]${row.snapshot ? ` [${row.snapshot}]` : ""}${row.changes ? ` [${row.changes.join(", ")}]` : ""}${row.unresolved ? ` unresolved: ${row.unresolved}` : ""}${row.edge.length ? `  ${row.edge.map(edge => `${edge.kind} (${edge.provenance}${edge.snapshot ? `, ${edge.snapshot}` : ""}): ${edge.from} -> ${edge.to}`).join("; ")}` : ""}`);
  if (!answer.rows) lines.push(...answer.hints);
  return lines.join("\n");
}
