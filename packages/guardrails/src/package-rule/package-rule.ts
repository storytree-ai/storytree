/**
 * Capability 1 · The package rule (the Guardrails story, ADR-0911 D2): which parts of a checkout break
 * one package per story and roads one way (ADR-0649 D1-D3, in storytree 0.2's decision log). A user's
 * project runs it as `storytree check`; storytree's own dev loop runs the same code with its own
 * declarations (packages/dev-loop/src/package-boundaries.mjs), so the two cannot drift.
 *
 * - Every story has its own package, `packages/<id>`, and every package belongs to a story or to a
 *   declared frame: no package belongs to no story (ADR-0805 D5, which narrows ADR-0649 D1). A project
 *   that declares no stories has one per package under packages/, as the habits card lays them out.
 * - A declared frame (storytree's `packages/app` and `apps/desktop`: startup, lifecycle, updates and
 *   mounting each story's surface) holds no other story's code, and neither does a declared front door
 *   (storytree's `packages/cli`: command families that call the story package owning the work). What
 *   gives such code away is its name: a folder or file in the frame named after a story, or a folder
 *   in the front door (a command family is one file, named after the story it fronts, so the front
 *   door's files may carry a story's name). A test there that reaches the story it is named after
 *   through that story's package is the frame testing its own mounting of it, and passes. A refused
 *   file that leans on the frame is not told to move into the story's package, which would make the
 *   story depend on the frame (ADR-0847).
 * - No package reaches into another story's files: not by a relative path into its folder, and not
 *   by a subpath of the story's package that its package.json does not export.
 * - No workspace packages depend on each other in a cycle, not even through a devDependency. pnpm
 *   links each workspace dependency into the dependent's node_modules, as a directory junction on
 *   Windows, and git walks a junction as an ordinary folder, so a cycle is a folder loop: a `git clean`
 *   of a reused worktree then never finishes (storytree 0.2 met it in 2026-08, 0.3 on 2026-09-28).
 * - No story leans on a declared frame or front door (ADR-0847 D1): a story package depending on one,
 *   through any dependency field, is refused, unless the owner sanctioned that edge in the edge list,
 *   with his own words and the date (D2). The list holds only his exceptions. Every other edge that
 *   runs one way is allowed unlisted. A listed edge no package.json uses any more is reported.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** A frame, or a front door: folders that mount or front the stories and hold none of their code. */
export interface Frame {
  /** The story the frame's own code belongs to. */
  readonly story: string;
  /** Its folders, repo-relative. */
  readonly dirs: readonly string[];
  /** A front door's files may carry the name of the story they front; only its folders may not. */
  readonly frontDoor?: boolean;
}

/** An owner-sanctioned edge from a story's package to a frame's, in his own words with the date. */
export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly said?: string | null;
  readonly on?: string | null;
}

/** Story code a frame still holds, with the open question that decides when it moves. */
export interface NotYetMoved {
  readonly path: string;
  readonly question: string;
}

/** What a project declares to the package rule; a user's project declares nothing. */
export interface Declarations {
  /** The stories, each by its package's folder name; by default, every package under packages/. */
  readonly stories?: readonly string[];
  readonly frames?: readonly Frame[];
  readonly notYetMoved?: readonly NotYetMoved[];
  readonly edges?: { readonly edges: readonly Edge[] };
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", ".turbo"]);
/** This rule's own test, whose planted trees are written as the very imports it must refuse. */
const OWN_TEST = "packages/guardrails/src/package-rule/package-rule.test.ts";

/** The stories of a project that declares none: one per package under packages/. */
export function storiesOf(root: string): string[] {
  return packageDirs(root, "packages").map((dir) => dir.slice("packages/".length));
}

/** What in the checkout at `root` breaks the package rule, one sentence each; empty when nothing does. */
export function packageProblems(root: string, declared: Declarations = {}): string[] {
  const stories = declared.stories ?? storiesOf(root);
  const frames = declared.frames ?? [];
  const notYetMoved = declared.notYetMoved ?? [];
  const edges = declared.edges?.edges ?? [];
  const problems: string[] = [];
  const packages = [...packageDirs(root, "packages"), ...packageDirs(root, "apps")];

  for (const story of stories) {
    if (!packages.includes(`packages/${story}`)) {
      problems.push(`the story ${story} has no package: its code belongs in packages/${story}`);
    }
  }
  const frameDirs = new Set(frames.flatMap((frame) => frame.dirs));
  for (const dir of packages) {
    const name = dir.slice(dir.indexOf("/") + 1);
    const known = frameDirs.has(dir) || (dir.startsWith("packages/") && stories.includes(name));
    if (!known) problems.push(`${dir} is neither a story's package nor the frame: every package belongs to a story (ADR-0805 D5)`);
  }

  const frameNames = new Set([...frameDirs].filter((dir) => packages.includes(dir)).map((dir) => packageName(root, dir)));
  const moved = new Map(notYetMoved.map((entry) => [entry.path, { ...entry, holds: false }]));
  for (const { story: own, dirs, frontDoor = false } of frames) {
    for (const dir of dirs) {
      for (const file of filesUnder(root, `${dir}/src`)) {
        const segments = file.slice(dir.length + "/src/".length).split("/");
        const named = frontDoor ? segments.slice(0, -1) : segments;
        const story = stories.find((id) => id !== own && named.some((segment) => namedAfter(segment, id)));
        if (story === undefined) continue;
        const imports = CODE.test(file) ? importsOf(readFileSync(path.join(root, file), "utf8")) : [];
        const storyName = packages.includes(`packages/${story}`) ? packageName(root, `packages/${story}`) : undefined;
        if (TEST.test(file) && storyName !== undefined && imports.some((specifier) => specifier === storyName || specifier.startsWith(`${storyName}/`))) continue;
        const entry = [...moved.values()].find((held) => file.startsWith(`${held.path}/`));
        if (entry) entry.holds = true;
        else if (imports.some((specifier) => specifier.startsWith(".") || frameNames.has(packageOfSpecifier(specifier)))) {
          problems.push(`${file} is named after the ${story} story but leans on the ${frontDoor ? "front door" : "frame"}, so moving it into packages/${story} would make that story depend on the frame (ADR-0847): a test of the frame mounting the story reaches it through ${storyName ?? `the ${story} package`}; anything else keeps a name of the frame's own, or moves its story part into packages/${story} behind its exports`);
        } else problems.push(`${file} is the ${story} story's code in the ${frontDoor ? "front door" : "frame"}: move it into packages/${story}`);
      }
    }
  }
  for (const entry of moved.values()) {
    if (!entry.holds) problems.push(`${entry.path} no longer holds story code: take it off NOT_YET_MOVED (and settle ${entry.question})`);
  }

  const storyDirs = new Map(stories.filter((id) => packages.includes(`packages/${id}`)).map((id) => [`packages/${id}`, id] as const));
  const storyByName = new Map([...storyDirs].map(([dir, id]) => [packageName(root, dir), id] as const));
  for (const dir of packages) {
    for (const file of filesUnder(root, `${dir}/src`).filter((name) => CODE.test(name) && name !== OWN_TEST)) {
      for (const specifier of importsOf(readFileSync(path.join(root, file), "utf8"))) {
        const reach = reachesInto(root, dir, file, specifier, storyDirs, storyByName);
        if (reach) problems.push(`${file} reaches into the ${reach} story's files with "${specifier}": import its package's exports instead`);
      }
    }
  }
  const deps = workspaceDependencies(root, packages);
  const sanctioned = new Set(edges.filter((edge) => edge.said).map((edge) => `${edge.from} ${edge.to}`));
  for (const [from, tos] of deps) {
    if (frameNames.has(from)) continue;
    for (const to of tos) {
      if (frameNames.has(to) && !sanctioned.has(`${from} ${to}`)) {
        problems.push(`${from} → ${to} is a story depending on the frame or the front door, which the owner has not sanctioned in package-edges.json: move the seam, or raise a question on the arc rather than adding it yourself (ADR-0847)`);
      }
    }
  }
  for (const { from, to } of edges) {
    if (!deps.get(from)?.includes(to)) problems.push(`${from} → ${to} is in package-edges.json but no package.json uses it any more: take it off the list`);
  }
  for (const cycle of dependencyCycles(deps)) {
    problems.push(`these packages depend on each other in a cycle: ${cycle.join(" → ")}; a workspace links it into a folder loop that git clean never leaves, so drop one of its edges`);
  }
  return problems;
}

/** The package a bare specifier names: "@scope/name" or "name", without its subpath. */
function packageOfSpecifier(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

/** The package.json in the repo-relative folder `dir`, read past a byte-order mark as Windows editors write one. */
function manifestAt(root: string, dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
}

/** The name the package at the repo-relative folder `dir` has in its package.json. */
function packageName(root: string, dir: string): string {
  return (manifestAt(root, dir) as { name?: string }).name ?? dir;
}

/** Each workspace package's name and the workspace packages it depends on, through any dependency field. */
function workspaceDependencies(root: string, packages: readonly string[]): Map<string, string[]> {
  const named = new Map<string, string[]>();
  for (const dir of packages) {
    const manifest = manifestAt(root, dir) as Record<string, unknown>;
    const name = typeof manifest.name === "string" ? manifest.name : dir;
    named.set(name, ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) => Object.keys((manifest[field] as object | undefined) ?? {})));
  }
  return new Map([...named].map(([name, all]) => [name, [...new Set(all.filter((dep) => named.has(dep)))]]));
}

/** Each cycle among the workspace packages' dependencies, once, as names from and back to its least. */
function dependencyCycles(deps: Map<string, string[]>): string[][] {
  const cycles = new Map<string, string[]>();
  const visit = (name: string, trail: string[]): void => {
    const at = trail.indexOf(name);
    if (at >= 0) {
      const loop = trail.slice(at);
      const least = loop.indexOf([...loop].sort()[0]!);
      const cycle = [...loop.slice(least), ...loop.slice(0, least)];
      cycles.set(cycle.join(" "), [...cycle, cycle[0]!]);
      return;
    }
    for (const next of deps.get(name) ?? []) visit(next, [...trail, name]);
  };
  for (const name of deps.keys()) visit(name, []);
  return [...cycles.values()];
}

/** The story whose files `specifier`, imported from `file` in package `dir`, reaches into; else undefined. */
function reachesInto(root: string, dir: string, file: string, specifier: string, storyDirs: Map<string, string>, storyByName: Map<string, string>): string | undefined {
  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    for (const [storyDir, story] of storyDirs) {
      if (storyDir !== dir && target.startsWith(`${storyDir}/`)) return story;
    }
    return undefined;
  }
  const name = packageOfSpecifier(specifier);
  const story = storyByName.get(name);
  if (story === undefined || specifier === name) return undefined;
  const manifest = manifestAt(root, `packages/${story}`) as { exports?: unknown };
  const exported = typeof manifest.exports === "object" && manifest.exports !== null ? Object.keys(manifest.exports) : [];
  return exported.includes(`./${specifier.slice(name.length + 1)}`) ? undefined : story;
}

/** Whether a path segment (a folder or file name, in any case style) carries the story id's words. */
function namedAfter(segment: string, id: string): boolean {
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const story = id.split("-");
  return words.some((_, at) => story.every((word, i) => words[at + i] === word));
}

/** The module specifiers a source file imports or re-exports, statically or dynamically. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\b(?:import|export)\s[^'"]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

/** The workspace packages directly under `parent` (packages or apps), as repo-relative paths. */
function packageDirs(root: string, parent: string): string[] {
  if (!existsSync(path.join(root, parent))) return [];
  return readdirSync(path.join(root, parent))
    .filter((name) => existsSync(path.join(root, parent, name, "package.json")))
    .sort()
    .map((name) => `${parent}/${name}`);
}

/** Every file under the repo-relative folder `dir`, as repo-relative paths with forward slashes. */
function filesUnder(root: string, dir: string): string[] {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  const files: string[] = [];
  for (const name of readdirSync(full)) {
    if (SKIP.has(name)) continue;
    const child = `${dir}/${name}`;
    if (statSync(path.join(root, child)).isDirectory()) files.push(...filesUnder(root, child));
    else files.push(child);
  }
  return files;
}
