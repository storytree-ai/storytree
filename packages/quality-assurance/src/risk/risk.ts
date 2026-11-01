/**
 * Capability 6 · Risk reading. A change's risk line and each story's standing risk reading, read deterministically from
 * the code and the package graph (question_1740edf77e9e; the scale question_0f21964e8ce0 settled, option A with both
 * levers: additive schema and the fix loop count depth 2, high at 8+). Rating is 2 x depth + radius, 3 to 10. Depth (1 to
 * 3) is how bad a break is where it lands; radius (1 to 4) how far it spreads: the larger of the stories downstream and
 * the audience served, which a package inherits from every package downstream of it (its depth it never inherits).
 * A model that thinks a reading wrong raises a question to the owner; it never overrides it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { packagesOf, type StoryNamed } from "@storytree/map/package-of";

export type Audience = "owner" | "invited" | "public";
export type Tier = "low" | "medium" | "high";

/** A workspace package as the graph reads it: its folder from the checkout (`packages/app`), its name and what it depends on. */
export interface PackageNode {
  readonly folder: string;
  readonly name: string;
  readonly deps: readonly string[];
}

/** The packages that face users themselves; every other package inherits its audience from those downstream of it. */
export const OWN_AUDIENCE: Readonly<Record<string, Audience>> = {
  "apps/desktop": "invited",
  "packages/app": "invited",
  "packages/website": "public",
};

/** The packages that draw a screen someone uses: a change to one is at least depth 2. */
export const SCREENS: ReadonlySet<string> = new Set(["apps/desktop", "packages/app", "packages/forest", "packages/forest-world", "packages/arc-surface", "packages/map", "packages/website"]);

const STORE = /^packages\/local-postgres\//;
const KEYS = /^packages\/keys\//;
const RELEASE = /^(packages\/app\/src\/updates\/|apps\/desktop\/src\/main\/releases?\.ts$|apps\/desktop\/(release|release-assets|delivery-assets|dist|mac-signing)\.mjs$|apps\/desktop\/(installer\.nsh|entitlements\.mac\.plist)$)/;
const FIX_LOOP = /^(packages\/(agent-pool|base-dev-loop|repo-checks|ci-health|quality-assurance)\/|\.github\/workflows\/)/;
const DESTRUCTIVE_SCHEMA = /\bDROP\s+(TABLE|COLUMN)\b|\bRENAME\s+(TO|COLUMN)\b|\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i;
const ADDITIVE_SCHEMA = /\bCREATE\s+TABLE\b|\bADD\s+COLUMN\b/i;
const CREDENTIALS = /@storytree\/keys|process\.env\.[A-Z_]*(TOKEN|SECRET|KEY)\b/;
const WRITES = /\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+\S+\s+SET\b/i;

/** Depth 3 flags; every other flag is depth 2. */
const DEEP: ReadonlySet<string> = new Set(["destructive schema", "credentials", "release path", "store"]);

/** Tests, docs, the lockfile and evidence carry no risk of their own. */
export function skipped(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(file) || /(^|\/)test\//.test(file) || /\.md$/.test(file) || file === "pnpm-lock.yaml" || /(^|\/)evidence\//.test(file);
}

/** The flags a file's path raises. */
export function pathFlags(file: string): string[] {
  const flags: string[] = [];
  if (STORE.test(file)) flags.push("store");
  if (KEYS.test(file)) flags.push("credentials");
  if (RELEASE.test(file)) flags.push("release path");
  if (FIX_LOOP.test(file)) flags.push("fix loop");
  const folder = folderOf(file);
  if (folder !== undefined && SCREENS.has(folder)) flags.push("screen");
  return flags;
}

/** The flags one line of code raises. */
export function lineFlags(line: string): string[] {
  const flags: string[] = [];
  if (DESTRUCTIVE_SCHEMA.test(line)) flags.push("destructive schema");
  else if (ADDITIVE_SCHEMA.test(line)) flags.push("additive schema");
  if (CREDENTIALS.test(line)) flags.push("credentials");
  if (WRITES.test(line)) flags.push("record writes");
  return flags;
}

/** The depth a set of flags reads: 3 for any deep flag, 2 for any other, else 1. */
export function depthOf(flags: Iterable<string>): 1 | 2 | 3 {
  let depth: 1 | 2 | 3 = 1;
  for (const flag of flags) depth = DEEP.has(flag) ? 3 : Math.max(depth, 2) as 2 | 3;
  return depth;
}

/** The radius a downstream count and an audience read: the larger of 18+ 4, 10+ 3, 3+ 2, else 1, and public 3, invited 2, owner 1. */
export function radiusOf(downstream: number, audience: Audience): 1 | 2 | 3 | 4 {
  const reach = downstream >= 18 ? 4 : downstream >= 10 ? 3 : downstream >= 3 ? 2 : 1;
  const users = audience === "public" ? 3 : audience === "invited" ? 2 : 1;
  return Math.max(reach, users) as 1 | 2 | 3 | 4;
}

/** The tier a rating reads: high at 8 and above, medium 5 to 7, low below. */
export function tierOf(rating: number): Tier {
  return rating >= 8 ? "high" : rating >= 5 ? "medium" : "low";
}

/** The package folder a file sits in (`packages/app`), or undefined for a root file. */
export function folderOf(file: string): string | undefined {
  return /^((?:packages|apps)\/[^/]+)\//.exec(file.replace(/\\/g, "/"))?.[1];
}

/** The package graph as it reads downstream: each folder's downstream folders and its inherited audience. */
export class PackageGraph {
  readonly #byName = new Map<string, PackageNode>();
  readonly #users = new Map<string, string[]>();

  constructor(nodes: readonly PackageNode[], readonly ownAudience: Readonly<Record<string, Audience>> = OWN_AUDIENCE) {
    for (const node of nodes) {
      this.#byName.set(node.name, node);
      this.#users.set(node.folder, []);
    }
    for (const node of nodes) for (const dep of node.deps) {
      const used = this.#byName.get(dep);
      if (used !== undefined && used.folder !== node.folder) this.#users.get(used.folder)!.push(node.folder);
    }
  }

  /** Whether the graph holds this folder. */
  has(folder: string): boolean {
    return this.#users.has(folder);
  }

  /** Every folder downstream of these, not counting them. */
  downstream(folders: Iterable<string>): Set<string> {
    const own = new Set(folders);
    const seen = new Set<string>();
    const stack = [...own];
    while (stack.length > 0) for (const user of this.#users.get(stack.pop()!) ?? []) if (!seen.has(user)) {
      seen.add(user);
      stack.push(user);
    }
    for (const folder of own) seen.delete(folder);
    return seen;
  }

  /** The widest audience these folders serve, their own or one inherited from downstream, and the folder it comes from. */
  audience(folders: Iterable<string>): { audience: Audience; from: string | undefined } {
    const rank: Record<Audience, number> = { owner: 1, invited: 2, public: 3 };
    let best: { audience: Audience; from: string | undefined } = { audience: "owner", from: undefined };
    const own = [...folders];
    for (const folder of [...own, ...this.downstream(own)]) {
      const audience = this.ownAudience[folder];
      if (audience !== undefined && rank[audience] > rank[best.audience]) best = { audience, from: folder };
    }
    return best;
  }
}

/** Reads every workspace package under packages/ and apps/ of a checkout. */
export function readPackages(root: string): PackageNode[] {
  const nodes: PackageNode[] = [];
  for (const top of ["packages", "apps"]) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, top));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const folder = `${top}/${entry}`;
      let json: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try {
        json = JSON.parse(readFileSync(path.join(root, folder, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (json.name === undefined) continue;
      nodes.push({ folder, name: json.name, deps: Object.keys({ ...json.dependencies, ...json.devDependencies }) });
    }
  }
  return nodes;
}

/** The package folders a story owns: those its packages name, and apps/desktop for the desktop app's story (`app`). */
export function storyFolders(story: StoryNamed): string[] {
  const own = packagesOf(story);
  return [...own.map((name) => `packages/${name}`), ...(own[0] === "app" ? ["apps/desktop"] : [])];
}

/** An increment's risk line, as the library's increment.risk field holds it. */
export interface ChangeReading {
  readonly tier: Tier;
  readonly rating: number;
  readonly depth: 1 | 2 | 3;
  readonly radius: 1 | 2 | 3 | 4;
  readonly flags: string[];
  readonly stories: string[];
  readonly read: string;
}

/** The files a unified diff changes and the lines it adds or removes in each. */
export function diffLines(diff: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/\S+ b\/(\S+)$/.exec(line);
    if (header !== null) {
      current = [];
      files.set(header[1]!, current);
      continue;
    }
    if (current !== undefined && /^[+-](?![+-]{2} )/.test(line)) current.push(line.slice(1));
  }
  return files;
}

/** A change's risk line: from the files its diff changes (skipping tests, docs, the lockfile and evidence) and the graph. */
export function readChange(diff: string, graph: PackageGraph, stories: readonly StoryNamed[], read: string): ChangeReading {
  const flags = new Set<string>();
  const folders = new Set<string>();
  for (const [file, lines] of diffLines(diff)) {
    if (skipped(file)) continue;
    for (const flag of pathFlags(file)) flags.add(flag);
    for (const line of lines) for (const flag of lineFlags(line)) flags.add(flag);
    const folder = folderOf(file);
    if (folder !== undefined && graph.has(folder)) folders.add(folder);
  }
  let radius: 1 | 2 | 3 | 4 = 1;
  for (const folder of folders) radius = Math.max(radius, radiusOf(graph.downstream([folder]).size, graph.audience([folder]).audience)) as 1 | 2 | 3 | 4;
  const depth = depthOf(flags);
  const rating = 2 * depth + radius;
  const touched = stories.filter((story) => storyFolders(story).some((folder) => folders.has(folder))).map((story) => story.id).sort();
  return { tier: tierOf(rating), rating, depth, radius, flags: [...flags].sort(), stories: touched, read };
}

/** A story's standing risk reading, as the library's story.risk field holds it. */
export interface StoryReading {
  readonly depth: { readonly value: 1 | 2 | 3; readonly read: string; readonly reason: string };
  readonly radius: { readonly value: 1 | 2 | 3 | 4; readonly downstream: number; readonly audience: Audience; readonly read: string; readonly reason: string };
}

/** The source files under a folder, relative to the checkout, skipping node_modules and what {@link skipped} skips. */
export function sourceFiles(root: string, folder: string): string[] {
  const files: string[] = [];
  const walk = (relative: string) => {
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, relative));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const child = `${relative}/${entry}`;
      if (statSync(path.join(root, child)).isDirectory()) walk(child);
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|sql|nsh|plist)$/.test(entry) && !skipped(child)) files.push(child);
    }
  };
  walk(folder);
  return files.sort();
}

/** A story's standing reading: depth from the flags over its packages' source, radius from its place in the graph. */
export function readStory(story: StoryNamed, graph: PackageGraph, source: (folder: string) => ReadonlyMap<string, string>, read: string): StoryReading | undefined {
  const folders = storyFolders(story).filter((folder) => graph.has(folder));
  if (folders.length === 0) return undefined;
  const flags = new Set<string>();
  for (const folder of folders) {
    if (SCREENS.has(folder)) flags.add("screen");
    for (const [file, text] of source(folder)) {
      for (const flag of pathFlags(file)) flags.add(flag);
      for (const line of text.split("\n")) for (const flag of lineFlags(line)) flags.add(flag);
    }
  }
  const depth = depthOf(flags);
  const downstream = graph.downstream(folders).size;
  const { audience, from } = graph.audience(folders);
  const value = radiusOf(downstream, audience);
  const inherited = from === undefined ? "no audience of its own or downstream, so owner" : folders.includes(from) ? `serves ${audience} users itself` : `${audience} users, inherited from ${from}`;
  return {
    depth: { value: depth, read, reason: flags.size === 0 ? "no depth flag in its code" : `flags: ${[...flags].sort().join(", ")}` },
    radius: { value, downstream, audience, read, reason: `${downstream} package${downstream === 1 ? "" : "s"} downstream; ${inherited}` },
  };
}

/** Reads a folder's source files from a checkout, for {@link readStory}. */
export function checkoutSource(root: string): (folder: string) => Map<string, string> {
  return (folder) => new Map(sourceFiles(root, folder).map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
}

/** A risk line in one line: `medium 6 · depth 2 · radius 2 · flags record writes · stories story_…`. */
export function riskLineText(line: ChangeReading): string {
  return `${line.tier} ${line.rating} · depth ${line.depth} · radius ${line.radius} · flags ${line.flags.length === 0 ? "none" : line.flags.join(", ")} · stories ${line.stories.length === 0 ? "none" : line.stories.join(", ")}`;
}
