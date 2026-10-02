// Which parts of this repo break the package boundaries of ADR-0649 D1-D3 (in storytree 0.2's
// decision log). packages/dev-loop/src/package-boundaries.test.mjs runs it over the repo in `pnpm test` and CI.
//
// - Every story has its own package, `packages/<id>`, and the only other package is the frame's
//   `apps/desktop`: no package belongs to no story (ADR-0805 D5, which narrows ADR-0649 D1).
// - The frame (the app story's `packages/app` and `apps/desktop`: startup, lifecycle, updates and
//   mounting each story's surface) holds no other story's code, and neither does the front door
//   (the cli story's `packages/cli`: command families that call the story package owning the
//   work). What gives such code away is its name: a folder or file in the frame named after a
//   story, or a folder in the front door (a command family is one file, named after the story it
//   fronts, so the front door's files may carry a story's name). A test there that reaches the
//   story it is named after through that story's package is the frame testing its own mounting of
//   it, and passes. A refused file that leans on the frame is not told to move into the story's
//   package, which would make the story depend on the frame (ADR-0847).
// - No package reaches into another story's files: not by a relative path into its folder, and not
//   by a subpath of `@storytree/<story>` that its package.json does not export.
// - No workspace packages depend on each other in a cycle, not even through a devDependency. pnpm
//   links each workspace dependency into the dependent's node_modules, as a directory junction on
//   Windows, and git walks a junction as an ordinary folder, so a cycle is a folder loop: the
//   desktop app's `git clean` of a reused worktree then never finishes, and nor does the session's
//   start (0.2 met it in 2026-08, 0.3 on 2026-09-28).
// - No story leans on the frame or the front door (ADR-0847 D1): a story package depending on
//   packages/app, apps/desktop or packages/cli, through any dependency field, is refused, unless the
//   owner sanctioned that edge in package-edges.json beside this file, with his own words and the
//   date (D2). The list holds only his exceptions; a lane never adds one. Every other edge that runs
//   one way is allowed unlisted. A listed edge no package.json uses any more is reported.
//
// The stories live only in the library (ADR-0641), which CI cannot read, so their ids are declared
// here: a story added to the library is added to STORIES with its package, in the same change.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 0.3's own stories, each by the id its package has (packages/<id>). */
export const STORIES = ["agent-link", "app", "app-setup", "arc-surface", "cli", "dev-loop", "forest", "forest-world", "keys", "knowledge-core", "librarian", "library", "local-postgres", "map", "processes", "website"];
// app-setup: story_b91056a06337 (The app setup).
// processes: story_9abd84ab493f (Process ledger).
// dev-loop: story_95ed402f9bd3 (The dev loop, ADR-0805 D3).
// forest-world: story_ca702fee28cb (The world, ADR-0805 D1).
// local-postgres: story_1d360b6227d8 (The local database, ADR-0805 D2).
// keys: story_55eb820f95c9 (Keys, ADR-0843).

/**
 * Story code the frame still holds, each with the open question on storytree-0-3-scales-arc that
 * decides when it moves into its story's package. An entry that no longer holds anything is a
 * problem too, so the list is emptied as the code moves.
 */
export const NOT_YET_MOVED = [];

const FRAME = { story: "app", dirs: ["packages/app", "apps/desktop"] };
const FRONT_DOOR = { story: "cli", dirs: ["packages/cli"] };
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", ".turbo"]);
/** This check's own test, whose planted trees are written as the very imports it must refuse. */
const OWN_TEST = "packages/dev-loop/src/package-boundaries.test.mjs";

/** The owner's exceptions to the frame rule: { edges: [{ from, to, said, on }] }, each in his own words, with the date. */
export const EDGES = JSON.parse(readFileSync(new URL("./package-edges.json", import.meta.url), "utf8"));

/** What in the repo at `root` breaks the boundaries, one sentence each; empty when nothing does. */
export function boundaryProblems(root, { stories = STORIES, notYetMoved = NOT_YET_MOVED, edges = EDGES } = {}) {
  const problems = [];
  const packages = [...packageDirs(root, "packages"), ...packageDirs(root, "apps")];

  for (const story of stories) {
    if (!packages.includes(`packages/${story}`)) {
      problems.push(`the story ${story} has no package: its code belongs in packages/${story}`);
    }
  }
  const frameDirs = new Set([...FRAME.dirs, ...FRONT_DOOR.dirs]);
  for (const dir of packages) {
    const name = dir.slice(dir.indexOf("/") + 1);
    const known = frameDirs.has(dir) || (dir.startsWith("packages/") && stories.includes(name));
    if (!known) problems.push(`${dir} is neither a story's package nor the frame: every package belongs to a story (ADR-0805 D5)`);
  }

  const frameNames = new Set([...FRAME.dirs, ...FRONT_DOOR.dirs].filter((dir) => packages.includes(dir)).map((dir) => packageName(root, dir)));
  const moved = new Map(notYetMoved.map((entry) => [entry.path, { ...entry, holds: false }]));
  for (const { story: own, dirs } of [FRAME, FRONT_DOOR]) {
    const frontDoor = own === FRONT_DOOR.story;
    for (const dir of dirs) {
      for (const file of filesUnder(root, `${dir}/src`)) {
        const segments = file.slice(dir.length + "/src/".length).split("/");
        const named = frontDoor ? segments.slice(0, -1) : segments;
        const story = stories.find((id) => id !== own && named.some((segment) => namedAfter(segment, id)));
        if (story === undefined) continue;
        const imports = CODE.test(file) ? importsOf(readFileSync(path.join(root, file), "utf8")) : [];
        if (TEST.test(file) && imports.some((specifier) => specifier === `@storytree/${story}` || specifier.startsWith(`@storytree/${story}/`))) continue;
        const entry = [...moved.values()].find((held) => file.startsWith(`${held.path}/`));
        if (entry) entry.holds = true;
        else if (imports.some((specifier) => specifier.startsWith(".") || frameNames.has(specifier.split("/").slice(0, 2).join("/")))) {
          problems.push(`${file} is named after the ${story} story but leans on the ${frontDoor ? "front door" : "frame"}, so moving it into packages/${story} would make that story depend on the frame (ADR-0847): a test of the frame mounting the story reaches it through @storytree/${story}; anything else keeps a name of the frame's own, or moves its story part into packages/${story} behind its exports`);
        } else problems.push(`${file} is the ${story} story's code in the ${frontDoor ? "front door" : "frame"}: move it into packages/${story}`);
      }
    }
  }
  for (const entry of moved.values()) {
    if (!entry.holds) problems.push(`${entry.path} no longer holds story code: take it off NOT_YET_MOVED (and settle ${entry.question})`);
  }

  const storyDirs = new Map(stories.filter((id) => packages.includes(`packages/${id}`)).map((id) => [`packages/${id}`, id]));
  for (const dir of packages) {
    for (const file of filesUnder(root, `${dir}/src`).filter((name) => CODE.test(name) && name !== OWN_TEST)) {
      for (const specifier of importsOf(readFileSync(path.join(root, file), "utf8"))) {
        const reach = reachesInto(root, dir, file, specifier, storyDirs, stories);
        if (reach) problems.push(`${file} reaches into the ${reach} story's files with "${specifier}": import its package's exports instead`);
      }
    }
  }
  const deps = workspaceDependencies(root, packages);
  const sanctioned = new Set(edges.edges.filter((edge) => edge.said).map((edge) => `${edge.from} ${edge.to}`));
  for (const [from, tos] of deps) {
    if (frameNames.has(from)) continue;
    for (const to of tos) {
      if (frameNames.has(to) && !sanctioned.has(`${from} ${to}`)) {
        problems.push(`${from} → ${to} is a story depending on the frame or the front door, which the owner has not sanctioned in package-edges.json: move the seam, or raise a question on the arc rather than adding it yourself (ADR-0847)`);
      }
    }
  }
  for (const { from, to } of edges.edges) {
    if (!deps.get(from)?.includes(to)) problems.push(`${from} → ${to} is in package-edges.json but no package.json uses it any more: take it off the list`);
  }
  for (const cycle of dependencyCycles(deps)) {
    problems.push(`these packages depend on each other in a cycle: ${cycle.join(" → ")}; pnpm links it into a folder loop that git clean never leaves, so drop one of its edges`);
  }
  return problems;
}

/** The name the package at the repo-relative folder `dir` has in its package.json. */
function packageName(root, dir) {
  return JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")).name;
}

/** Each workspace package's name and the workspace packages it depends on, through any dependency field. */
function workspaceDependencies(root, packages) {
  const named = new Map();
  for (const dir of packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
    named.set(manifest.name, ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) => Object.keys(manifest[field] ?? {})));
  }
  return new Map([...named].map(([name, all]) => [name, [...new Set(all.filter((dep) => named.has(dep)))]]));
}

/** Each cycle among the workspace packages' dependencies, once, as names from and back to its least. */
function dependencyCycles(deps) {
  const cycles = new Map();
  const visit = (name, trail) => {
    const at = trail.indexOf(name);
    if (at >= 0) {
      const loop = trail.slice(at);
      const least = loop.indexOf([...loop].sort()[0]);
      const cycle = [...loop.slice(least), ...loop.slice(0, least)];
      cycles.set(cycle.join(" "), [...cycle, cycle[0]]);
      return;
    }
    for (const next of deps.get(name) ?? []) visit(next, [...trail, name]);
  };
  for (const name of deps.keys()) visit(name, []);
  return [...cycles.values()];
}

/** The story whose files `specifier`, imported from `file` in package `dir`, reaches into; else undefined. */
function reachesInto(root, dir, file, specifier, storyDirs, stories) {
  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    for (const [storyDir, story] of storyDirs) {
      if (storyDir !== dir && target.startsWith(`${storyDir}/`)) return story;
    }
    return undefined;
  }
  const match = /^@storytree\/([^/]+)\/(.+)$/.exec(specifier);
  if (!match || !stories.includes(match[1]) || !storyDirs.has(`packages/${match[1]}`)) return undefined;
  const manifest = JSON.parse(readFileSync(path.join(root, "packages", match[1], "package.json"), "utf8"));
  const exported = typeof manifest.exports === "object" && manifest.exports !== null ? Object.keys(manifest.exports) : [];
  return exported.includes(`./${match[2]}`) ? undefined : match[1];
}

/** Whether a path segment (a folder or file name, in any case style) carries the story id's words. */
function namedAfter(segment, id) {
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const story = id.split("-");
  return words.some((_, at) => story.every((word, i) => words[at + i] === word));
}

/** The module specifiers a source file imports or re-exports, statically or dynamically. */
function importsOf(text) {
  const found = [];
  for (const pattern of [/\b(?:import|export)\s[^'"]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** The workspace packages directly under `parent` (packages or apps), as repo-relative paths. */
function packageDirs(root, parent) {
  if (!existsSync(path.join(root, parent))) return [];
  return readdirSync(path.join(root, parent))
    .filter((name) => existsSync(path.join(root, parent, name, "package.json")))
    .map((name) => `${parent}/${name}`);
}

/** Every file under the repo-relative folder `dir`, as repo-relative paths with forward slashes. */
function filesUnder(root, dir) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  const files = [];
  for (const name of readdirSync(full)) {
    if (SKIP.has(name)) continue;
    const child = `${dir}/${name}`;
    if (statSync(path.join(root, child)).isDirectory()) files.push(...filesUnder(root, child));
    else files.push(child);
  }
  return files;
}
