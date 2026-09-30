// Which parts of this repo break the package boundaries of ADR-0649 D1-D3 (in storytree 0.2's
// decision log). scripts/package-boundaries.test.mjs runs it over the repo in `pnpm test` and CI.
//
// - Every story has its own package, `packages/<id>`. Every other package is a
//   shared engine that belongs to no story, declared below, or the frame's `apps/desktop`.
// - The frame (the app story's `packages/app` and `apps/desktop`: startup, lifecycle, updates and
//   mounting each story's surface) holds no other story's code, and neither does the front door
//   (the cli story's `packages/cli`: command families that call the story package owning the
//   work). What gives such code away is its name: a folder or file in the frame named after a
//   story, or a folder in the front door (a command family is one file, named after the story it
//   fronts, so the front door's files may carry a story's name).
// - No package reaches into another story's files: not by a relative path into its folder, and not
//   by a subpath of `@storytree/<story>` that its package.json does not export. A shared engine's
//   files are no story's, so they are not covered.
// - No workspace packages depend on each other in a cycle, not even through a devDependency. pnpm
//   links each workspace dependency into the dependent's node_modules, as a directory junction on
//   Windows, and git walks a junction as an ordinary folder, so a cycle is a folder loop: the
//   desktop app's `git clean` of a reused worktree then never finishes, and nor does the session's
//   start (0.2 met it in 2026-08, 0.3 on 2026-09-28).
//
// The stories live only in the library (ADR-0641), which CI cannot read, so their ids are declared
// here: a story added to the library is added to STORIES with its package, in the same change.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 0.3's own stories, each by the id its package has (packages/<id>). */
export const STORIES = ["agent-link", "app", "app-setup", "arc-surface", "cli", "forest", "knowledge-core", "librarian", "library", "processes", "website"];
// app-setup: story_b91056a06337 (The app setup).
// processes: story_9abd84ab493f (Process ledger).

/** Packages that belong to no story and hold no story's code (ADR-0649 D1). */
export const SHARED_ENGINES = ["forest-world", "local-postgres"];

/**
 * Story code the frame still holds, each with the open question on storytree-0-3-scales-arc that
 * decides when it moves into its story's package. An entry that no longer holds anything is a
 * problem too, so the list is emptied as the code moves.
 */
export const NOT_YET_MOVED = [];

const FRAME = { story: "app", dirs: ["packages/app", "apps/desktop"] };
const FRONT_DOOR = { story: "cli", dirs: ["packages/cli"] };
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = new Set(["node_modules", "dist", ".turbo"]);

/** What in the repo at `root` breaks the boundaries, one sentence each; empty when nothing does. */
export function boundaryProblems(root, { stories = STORIES, sharedEngines = SHARED_ENGINES, notYetMoved = NOT_YET_MOVED } = {}) {
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
    const known = frameDirs.has(dir) || (dir.startsWith("packages/") && (stories.includes(name) || sharedEngines.includes(name)));
    if (!known) problems.push(`${dir} is neither a story's package, a declared shared engine, nor the frame`);
  }

  const moved = new Map(notYetMoved.map((entry) => [entry.path, { ...entry, holds: false }]));
  for (const { story: own, dirs } of [FRAME, FRONT_DOOR]) {
    const frontDoor = own === FRONT_DOOR.story;
    for (const dir of dirs) {
      for (const file of filesUnder(root, `${dir}/src`)) {
        const segments = file.slice(dir.length + "/src/".length).split("/");
        const named = frontDoor ? segments.slice(0, -1) : segments;
        const story = stories.find((id) => id !== own && named.some((segment) => namedAfter(segment, id)));
        if (story === undefined) continue;
        const entry = [...moved.values()].find((held) => file.startsWith(`${held.path}/`));
        if (entry) entry.holds = true;
        else problems.push(`${file} is the ${story} story's code in the ${frontDoor ? "front door" : "frame"}: move it into packages/${story}`);
      }
    }
  }
  for (const entry of moved.values()) {
    if (!entry.holds) problems.push(`${entry.path} no longer holds story code: take it off NOT_YET_MOVED (and settle ${entry.question})`);
  }

  const storyDirs = new Map(stories.filter((id) => packages.includes(`packages/${id}`)).map((id) => [`packages/${id}`, id]));
  for (const dir of packages) {
    for (const file of filesUnder(root, `${dir}/src`).filter((name) => CODE.test(name))) {
      for (const specifier of importsOf(readFileSync(path.join(root, file), "utf8"))) {
        const reach = reachesInto(root, dir, file, specifier, storyDirs, stories);
        if (reach) problems.push(`${file} reaches into the ${reach} story's files with "${specifier}": import its package's exports instead`);
      }
    }
  }
  for (const cycle of dependencyCycles(root, packages)) {
    problems.push(`these packages depend on each other in a cycle: ${cycle.join(" → ")}; pnpm links it into a folder loop that git clean never leaves, so drop one of its edges`);
  }
  return problems;
}

/** Each cycle among the workspace packages' dependencies of every kind, once, as names from and back to its least. */
function dependencyCycles(root, packages) {
  const deps = new Map();
  for (const dir of packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
    const named = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) => Object.keys(manifest[field] ?? {}));
    deps.set(manifest.name, named);
  }
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
    for (const next of deps.get(name) ?? []) if (deps.has(next)) visit(next, [...trail, name]);
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
