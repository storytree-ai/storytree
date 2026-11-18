// Capability 9 · The package rule
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Frame {
  readonly story: string;
  readonly dirs: readonly string[];
  readonly frontDoor?: boolean;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly said?: string | null;
  readonly on?: string | null;
}

export interface NotYetMoved {
  readonly path: string;
  readonly question: string;
}

export interface Declarations {
  readonly stories?: readonly string[];
  readonly frames?: readonly Frame[];
  readonly notYetMoved?: readonly NotYetMoved[];
  readonly edges?: { readonly edges: readonly Edge[] };
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", ".turbo"]);
const OWN_TEST = "packages/repo-checks/src/rules/package-rule/package-rule.test.ts";

export function storiesOf(root: string): string[] {
  return packageDirs(root, "packages").map((dir) => dir.slice("packages/".length));
}

export function packageProblems(root: string, declared: Declarations = {}): string[] {
  const named: readonly unknown[] = declared.stories ?? storiesOf(root);
  const stories = named.filter((story): story is string => typeof story === "string");
  const frames = declared.frames ?? [];
  const notYetMoved = declared.notYetMoved ?? [];
  const edges = declared.edges?.edges ?? [];
  const problems: string[] = [];
  const packages = [...packageDirs(root, "packages"), ...packageDirs(root, "apps")];

  for (const story of named.filter((story) => typeof story !== "string")) {
    problems.push(`${JSON.stringify(story)} is no package's folder name: each story owns exactly one package, and is declared by its folder name (ADR-1078 rule 4)`);
  }
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
        problems.push(`${from} → ${to} is a story depending on the frame or the front door, which the owner has not sanctioned in storytree.check.json's edges: move the seam, or raise a question on the arc rather than adding it yourself (ADR-0847)`);
      }
    }
  }
  for (const { from, to } of edges) {
    if (!deps.get(from)?.includes(to)) problems.push(`${from} → ${to} is in storytree.check.json's edges but no package.json uses it any more: take it off the list`);
  }
  for (const cycle of dependencyCycles(deps)) {
    problems.push(`these packages depend on each other in a cycle: ${cycle.join(" → ")}; a workspace links it into a folder loop that git clean never leaves, so drop one of its edges`);
  }
  return problems;
}

function packageOfSpecifier(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

function manifestAt(root: string, dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
}

function packageName(root: string, dir: string): string {
  return (manifestAt(root, dir) as { name?: string }).name ?? dir;
}

function workspaceDependencies(root: string, packages: readonly string[]): Map<string, string[]> {
  const named = new Map<string, string[]>();
  for (const dir of packages) {
    const manifest = manifestAt(root, dir) as Record<string, unknown>;
    const name = typeof manifest.name === "string" ? manifest.name : dir;
    named.set(name, ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) => Object.keys((manifest[field] as object | undefined) ?? {})));
  }
  return new Map([...named].map(([name, all]) => [name, [...new Set(all.filter((dep) => named.has(dep)))]]));
}

function dependencyCycles(deps: Map<string, string[]>): string[][] {
  const components = dependencyComponents(deps);
  const within = new Map([...deps].map(([name, next]) => [name, next.filter((to) => components.get(name) === components.get(to))]));
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
    for (const next of within.get(name) ?? []) visit(next, [...trail, name]);
  };
  for (const [name, next] of within) if (next.length > 0) visit(name, []);
  return [...cycles.values()];
}

function dependencyComponents(deps: Map<string, string[]>): Map<string, string> {
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components = new Map<string, string>();
  const visit = (name: string): void => {
    const index = order.size;
    order.set(name, index);
    low.set(name, index);
    stack.push(name);
    active.add(name);
    for (const next of deps.get(name) ?? []) {
      if (!order.has(next)) {
        visit(next);
        low.set(name, Math.min(low.get(name)!, low.get(next)!));
      } else if (active.has(next)) {
        low.set(name, Math.min(low.get(name)!, order.get(next)!));
      }
    }
    if (low.get(name) === index) {
      let member: string;
      do {
        member = stack.pop()!;
        active.delete(member);
        components.set(member, name);
      } while (member !== name);
    }
  };
  for (const name of deps.keys()) if (!order.has(name)) visit(name);
  return components;
}

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

function namedAfter(segment: string, id: string): boolean {
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const story = id.split("-");
  return words.some((_, at) => story.every((word, i) => words[at + i] === word));
}

function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\b(?:import|export)\s[^'"]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

function packageDirs(root: string, parent: string): string[] {
  if (!existsSync(path.join(root, parent))) return [];
  return readdirSync(path.join(root, parent))
    .filter((name) => existsSync(path.join(root, parent, name, "package.json")))
    .sort()
    .map((name) => `${parent}/${name}`);
}

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
