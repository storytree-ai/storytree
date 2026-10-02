/** Capability 4 · Git changes joined to today's plan through the existing code survey. */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AnnotatedTree, Library } from "@storytree/library";
import { codeSurveyReader } from "./code-survey/read-survey.js";
import { buildGraph, type ChangeLabel, type MapEdge, type MapNode, type ProjectGraph } from "./graph.js";
import { impact } from "./impact.js";
import type { DiffSummary, FocusAnswer, FocusOptions } from "./focus.js";

export type AffectedOptions = Omit<FocusOptions, "select"> & { readonly range?: string };
const execute = promisify(execFile);
const MAX_GIT_BYTES = 64 * 1024 * 1024;

async function git(folder: string, args: readonly string[], input?: string): Promise<Buffer> {
  try {
    const running = execute("git", [...args], { cwd: folder, encoding: "buffer", maxBuffer: MAX_GIT_BYTES, timeout: 30_000, windowsHide: true });
    if (input !== undefined) running.child.stdin?.end(input);
    return (await running).stdout;
  } catch (error) {
    throw new Error(`Cannot read git ${args[0]}: ${error instanceof Error ? error.message : String(error)}. Git output is limited to 64 MiB.`);
  }
}
const gitText = async (folder: string, args: readonly string[]) => (await git(folder, args)).toString("utf8").trim();

async function comparison(folder: string, range: string): Promise<Pick<DiffSummary, "base" | "target" | "comparison">> {
  const resolve = async (ref: string) => {
    try { return await gitText(folder, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]); }
    catch { throw new Error(`Cannot resolve git ref ${JSON.stringify(ref)} to a commit.`); }
  };
  const pair = /^(.+?)(\.\.\.?)(.+)$/.exec(range);
  if (pair) {
    const [left, right] = await Promise.all([resolve(pair[1]!), resolve(pair[3]!)]);
    return { base: pair[2] === "..." ? await gitText(folder, ["merge-base", left, right]) : left, target: right, comparison: pair[2] === "..." ? "merge-base" : "commits" };
  }
  if (range.includes("..")) throw new Error("A git range needs both refs: A..B or A...B.");
  const [ref, head] = await Promise.all([resolve(range), resolve("HEAD")]);
  return { base: await gitText(folder, ["merge-base", ref, head]), target: "working-tree", comparison: "working-tree" };
}

async function changesAt(folder: string, comparison: Pick<DiffSummary, "base" | "target">): Promise<{ paths: Map<string, ChangeLabel[]>; renames: number }> {
  const fields = (await git(folder, ["diff", "--name-status", "-z", "-M", comparison.base, ...(comparison.target === "working-tree" ? [] : [comparison.target]), "--"])).toString("utf8").split("\0");
  const paths = new Map<string, ChangeLabel[]>();
  const add = (file: string, label: ChangeLabel) => paths.set(file, [...new Set([...paths.get(file) ?? [], label])]);
  let renames = 0;
  for (let at = 0; fields[at];) {
    const status = fields[at++]!;
    const file = fields[at++];
    if (file === undefined) throw new Error("Git returned an incomplete changed-path record.");
    if (status.startsWith("R")) {
      const to = fields[at++];
      if (to === undefined) throw new Error("Git returned an incomplete rename record.");
      add(file, "renamed-from"); add(to, "renamed-to"); renames++;
    } else add(file, status === "A" ? "added" : status === "D" ? "deleted" : "modified");
  }
  if (comparison.target === "working-tree") {
    for (const file of (await git(folder, ["ls-files", "--others", "--exclude-standard", "-z"])).toString("utf8").split("\0")) if (file) add(file, "untracked");
  }
  return { paths, renames };
}

/** Only regular source inputs the existing reader uses; never materialize links, assets or excluded trees. */
function surveyInput(file: string): boolean {
  if (file.split("/").some(part => ["node_modules", "dist", "out", "evidence"].includes(part))) return false;
  if (/^(?:packages\/[^/]+|apps\/desktop)\/(?:package\.json|survey-coverage\.json)$/.test(file)) return true;
  return /^(?:packages\/[^/]+|apps\/desktop)\/src\/.+\.[cm]?[jt]sx?$/.test(file);
}

async function historicalGraph(folder: string, commit: string, tree: AnnotatedTree): Promise<ProjectGraph> {
  const entries = (await git(folder, ["ls-tree", "-rz", "--full-tree", commit])).toString("utf8").split("\0").flatMap(entry => {
    const tab = entry.indexOf("\t");
    if (tab < 0) return [];
    const [mode, type, sha] = entry.slice(0, tab).split(" ");
    const file = entry.slice(tab + 1);
    return (mode === "100644" || mode === "100755") && type === "blob" && sha && surveyInput(file) ? [{ file, sha }] : [];
  });
  const shas = [...new Set(entries.map(entry => entry.sha))];
  const blobs = new Map<string, Buffer>();
  if (shas.length) {
    const output = await git(folder, ["cat-file", "--batch"], shas.join("\n") + "\n");
    let at = 0;
    for (const sha of shas) {
      const end = output.indexOf(10, at);
      const header = /^(\S+) blob (\d+)$/.exec(output.subarray(at, end).toString("ascii"));
      if (end < at || !header || header[1] !== sha) throw new Error("Git returned an invalid snapshot blob header.");
      const size = Number(header[2]);
      const next = end + 1 + size;
      if (!Number.isSafeInteger(size) || next >= output.length || output[next] !== 10) throw new Error("Git returned an incomplete snapshot blob.");
      blobs.set(sha, output.subarray(end + 1, next));
      at = next + 1;
    }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "storytree-map-snapshot-"));
  try {
    for (let at = 0; at < entries.length; at += 64) {
      await Promise.all(entries.slice(at, at + 64).map(async ({ file, sha }) => {
        const full = path.resolve(temporary, file);
        if (!full.startsWith(temporary + path.sep)) throw new Error(`Git snapshot path escapes its temporary directory: ${file}`);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, blobs.get(sha)!);
      }));
    }
    return buildGraph(tree, await codeSurveyReader({ checkout: "current" }).read(temporary, tree));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Today's plan is common to both readings; code edges are a conservative union, independent of evidence provenance. */
function union(base: ProjectGraph, target: ProjectGraph): ProjectGraph {
  const nodes = new Map<string, MapNode>(base.nodes.map(node => [node.id, { ...node, snapshot: "base" }]));
  const edges = new Map<string, MapEdge>();
  for (const node of target.nodes) nodes.set(node.id, { ...node, snapshot: nodes.has(node.id) ? "both" : "target" });
  for (const [graph, snapshot] of [[base, "base"], [target, "target"]] as const) {
    for (const edge of graph.edges) {
      const key = JSON.stringify([edge.from, edge.to, edge.kind, edge.provenance]);
      edges.set(key, { ...edge, snapshot: edges.has(key) ? "both" : snapshot });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], healthSource: target.healthSource };
}

export async function affectedProject(library: Pick<Library, "projectTree">, folder: string, options: AffectedOptions): Promise<FocusAnswer> {
  const range = options.range || "origin/main";
  const root = await gitText(folder, ["rev-parse", "--show-toplevel"]);
  const compared = await comparison(root, range);
  const changed = await changesAt(root, compared);
  const tree = await library.projectTree();
  const [base, target] = await Promise.all([
    historicalGraph(root, compared.base, tree),
    compared.target === "working-tree" ? codeSurveyReader({ checkout: "current" }).read(root, tree).then(survey => buildGraph(tree, survey)) : historicalGraph(root, compared.target, tree),
  ]);
  const graph = union(base, target);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const byPath = new Map(graph.nodes.flatMap(node => node.path === undefined ? [] : [[node.path, node] as const]));
  const selected: string[] = [];
  const statuses: DiffSummary["statuses"] = {};
  let unresolved = 0;
  for (const [file, changes] of changed.paths) {
    const existing = byPath.get(file);
    const kind = /(?:^|\/)testing\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) ? "test" : "file";
    const node: MapNode = existing ?? { id: `${kind}:${file}`, kind, path: file, title: file, story: "", health: "untested", snapshot: changes.some(change => change === "deleted" || change === "renamed-from") ? "base" : changes.includes("modified") ? "both" : "target" };
    const owns = graph.edges.some(edge => edge.from === node.id && (edge.kind === "implements" || edge.kind === "tests") && ["capability", "promise"].includes(nodes.get(edge.to)?.kind ?? ""));
    const reason = !existing ? "Changed path is outside the surveyed code." : !owns ? "No capability or promise ownership was found in either code reading." : undefined;
    if (reason) unresolved++;
    nodes.set(node.id, { ...node, changes, ...(reason === undefined ? {} : { unresolved: reason }) });
    selected.push(node.id);
    for (const change of changes) statuses[change] = (statuses[change] ?? 0) + 1;
  }
  const answer = impact({ ...graph, nodes: [...nodes.values()] }, selected, `diff:${range}`, options);
  return { ...answer, diff: { range, ...compared, changedPaths: changed.paths.size, renames: changed.renames, unresolved, statuses, notes: [
    "Both code readings use today's plan, not historical promise wording.",
    "Impact conservatively joins base and target edges; a route may combine both readings.",
  ] } };
}
