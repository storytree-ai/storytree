// What `pnpm test` runs by default (ADR-0649 D4): only the packages a branch's changes can reach.
// test.mjs runs it, locally and in CI alike, so the two never decide differently.
//
// The changes are the branch against where it left main, merge-base(origin/main, HEAD), plus the
// working tree, untracked files included. Each changed file maps to the workspace package
// (packages/*, apps/*) that holds it. Every package that depends on one of those is added, all the
// way up: by a dependency its package.json declares, or by a relative path in its code that reaches
// into the other package (agent-link builds cli's bin by path, and cli depends on agent-link, not
// the other way round), since neither kind of edge would be seen by the other alone.
//
// It fails WIDE: whatever the workspace graph cannot account for runs everything. That is a root
// file (README.md, stories/, decisions/, tsconfig.base.json, .github/, ...), any package.json (the
// graph's own input), the lockfile, a file in no package, a package the root workspace depends on
// (the dev loop, whose runner, scoper and gate decide how every test runs, ADR-0805 D4, and the
// packages it runs on), no change at all, and an
// origin/main that cannot be read. Running a suite a change could not reach costs minutes; skipping
// one it could reach merges untested code, so every doubt resolves to the full run. A root path is
// narrowed only once its test-time readers have been measured, never by guessing (0.2's ADR-0394).

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE_ROOTS = ["packages", "apps"];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const RELATIVE_PATH = /["'`]((?:\.\.\/)+[^"'`$\r\n]*)["'`]/g;

/**
 * Checks that a change inside any one package can fail, so every scoped run carries them as units
 * of their own (a full run has them in their package already). The package-boundary check (ADR-0649 D3)
 * is one: a story's code landing in the frame is a change to the frame alone.
 */
const ALWAYS_RUN = ["packages/dev-loop/src/package-boundaries.test.mjs"];

/**
 * The workspace packages: each one's name, its dir (repo-relative, posix), the workspace packages
 * its package.json names, and the other packages' dirs its code reaches by a relative path. Also
 * which packages the root package.json depends on, as `rootDeps`.
 */
export function readWorkspace(root) {
  const packages = [];
  for (const base of WORKSPACE_ROOTS) {
    let entries = [];
    try {
      entries = readdirSync(path.join(root, base), { withFileTypes: true });
    } catch {}
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = readManifest(path.join(root, base, entry.name, "package.json"));
      if (typeof manifest?.name === "string") {
        packages.push({ name: manifest.name, dir: `${base}/${entry.name}`, deps: dependencyNames(manifest) });
      }
    }
  }
  const names = new Set(packages.map((p) => p.name));
  for (const pkg of packages) {
    pkg.deps = pkg.deps.filter((name) => names.has(name));
    pkg.reaches = reachesOf(root, pkg, packages);
  }
  packages.sort((a, b) => (a.dir < b.dir ? -1 : 1));
  packages.rootDeps = dependencyNames(readManifest(path.join(root, "package.json")) ?? {}).filter((n) => names.has(n));
  return packages;
}

function readManifest(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function dependencyNames(manifest) {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
}

/** The other packages' dirs that a relative path written in this package's code resolves into. */
function reachesOf(root, pkg, packages) {
  const reached = new Set();
  const files = globSync("**/*", { cwd: path.join(root, pkg.dir), exclude: (name) => ["node_modules", "dist"].includes(path.basename(String(name))) });
  for (const file of files) {
    if (!SOURCE.test(file)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, pkg.dir, file), "utf8");
    } catch {
      continue; // a directory whose name looks like a source file
    }
    const from = path.posix.dirname(`${pkg.dir}/${file.split(path.sep).join("/")}`);
    for (const [, relative] of text.matchAll(RELATIVE_PATH)) {
      const target = path.posix.normalize(path.posix.join(from, relative));
      const owner = packages.find((p) => p !== pkg && (target === p.dir || target.startsWith(`${p.dir}/`)));
      if (owner) reached.add(owner.dir);
    }
  }
  return [...reached].sort();
}

/**
 * Decide from a set of changed files: `{ mode: "full", reason }`, or `{ mode: "affected", dirs,
 * reason }` with the package dirs to run.
 */
export function classify(files, workspace) {
  const changed = files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean);
  if (changed.length === 0) return full("no change against origin/main, so nothing narrows the run");
  const touched = new Set();
  for (const file of changed) {
    if (file === "pnpm-lock.yaml") return full(`${file} changed: the lockfile can change what every package runs`);
    if (path.posix.basename(file) === "package.json") {
      return full(`${file} changed: package manifests are the dependency graph this scope is read from`);
    }
    const owner = workspace.find((p) => file.startsWith(`${p.dir}/`));
    if (owner === undefined) {
      const inWorkspace = WORKSPACE_ROOTS.some((base) => file.startsWith(`${base}/`));
      return full(inWorkspace ? `${file} changed and is in no workspace package` : `${file} changed outside the workspace packages`);
    }
    if (workspace.rootDeps?.includes(owner.name)) {
      return full(`${file} changed in ${owner.name}, which the test harness runs on`);
    }
    touched.add(owner.dir);
  }
  const selected = new Set(touched);
  for (let grew = true; grew; ) {
    grew = false;
    for (const pkg of workspace) {
      if (selected.has(pkg.dir)) continue;
      const uses = [...pkg.deps.map((name) => workspace.find((p) => p.name === name)?.dir), ...pkg.reaches];
      if (uses.some((dir) => selected.has(dir))) {
        selected.add(pkg.dir);
        grew = true;
      }
    }
  }
  const dirs = [...selected].sort();
  const dependents = dirs.filter((dir) => !touched.has(dir));
  const reason = `changed: ${[...touched].sort().join(", ")}${dependents.length ? `; their dependents: ${dependents.join(", ")}` : ""}`;
  return { mode: "affected", dirs, reason };
}

function full(reason) {
  return { mode: "full", reason };
}

/**
 * The files this branch changes: merge-base(origin/main, HEAD) against the working tree, deleted
 * and untracked files included. Throws when git cannot say, origin/main unreadable among them.
 */
export function changedFiles(root, base = "origin/main") {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const lines = (text) => text.split("\n").filter(Boolean);
  const tracked = lines(git("diff", "--name-only", "--no-renames", "-z", mergeBase).replaceAll("\0", "\n"));
  const untracked = lines(git("ls-files", "--others", "--exclude-standard", "-z").replaceAll("\0", "\n"));
  return [...new Set([...tracked, ...untracked])];
}

/** The decision for the checkout at `root`: its changed files classified, or the full run if git cannot say. */
export function scopeFor(root, workspace = readWorkspace(root)) {
  let files;
  try {
    files = changedFiles(root);
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim().split("\n")[0];
    return full(`the changes against origin/main could not be read (${detail})`);
  }
  return classify(files, workspace);
}

/** The decision as the one line a run prints first. */
export function scopeLine(decision) {
  const what = decision.mode === "full" ? "everything" : decision.dirs.join(", ") || "nothing";
  return `scope: ${decision.mode} — ${what} — ${decision.reason}`;
}

/**
 * The units a run executes, after the flags: `full` forces everything, `only` names packages (by
 * dir, dir name or package name), and `rerunFailed` takes the units the last recorded
 * run failed or never reached. Returns the decision as it now stands and the unit list.
 */
export function planRun({ root, workspace, decision, flags = {}, record }) {
  const all = workspace.filter((p) => hasTests(root, p.dir)).map((p) => p.dir);
  if (flags.full) decision = full("--full asked for everything");
  if (flags.only?.length) {
    const units = flags.only.map((wanted) => {
      const pkg = workspace.find((p) => wanted === p.dir || wanted === p.name || wanted === path.posix.basename(p.dir));
      if (pkg === undefined) throw new Error(`--only ${wanted}: no workspace package by that dir or name`);
      return pkg.dir;
    });
    const dirs = [...new Set(units)].sort();
    return { decision: { mode: "only", dirs, reason: "--only named them" }, units: dirs.filter((u) => all.includes(u)) };
  }
  if (flags.rerunFailed) {
    if (record === undefined) {
      return { decision: { mode: "rerun-failed", dirs: [], reason: "no earlier run is recorded in this checkout" }, units: [] };
    }
    const dirs = Object.entries(record.units ?? {})
      .filter(([, result]) => result !== "pass")
      .map(([unit]) => unit)
      .sort();
    const reason = dirs.length ? "what the last run failed or never reached" : "the last run failed nothing";
    return { decision: { mode: "rerun-failed", dirs, reason }, units: dirs };
  }
  if (decision.mode === "full") return { decision, units: all };
  const always = ALWAYS_RUN.filter((file) => existsSync(path.join(root, file)));
  return { decision, units: [...decision.dirs.filter((dir) => all.includes(dir)), ...always] };
}

/** The test files a unit runs, as the globs node --test is given: a unit may be one file. */
export function unitGlobs(unit) {
  return /\.test\.m?[jt]s$/.test(unit) ? [unit] : [`${unit}/src/**/*.test.ts`, `${unit}/src/**/*.test.mjs`];
}

function hasTests(root, dir) {
  return globSync(`${dir}/src/**/*.test.{ts,mjs}`, { cwd: root, exclude: (name) => path.basename(String(name)) === "node_modules" }).length > 0;
}

/** Each unit's result, PASS, FAIL or NOT RUN. Callers may add reasons and replace or omit the rerun hint. */
export function resultsTable(results, { reasons = {}, rerunHint = "rerun only these: pnpm run test --rerun-failed" } = {}) {
  const label = { pass: "PASS", fail: "FAIL", "not run": "NOT RUN" };
  const rows = Object.entries(results).map(([unit, result]) => `  ${label[result].padEnd(8)}${unit}${reasons[unit] ? ` — ${reasons[unit]}` : ""}`);
  const failed = Object.values(results).some((result) => result !== "pass");
  return ["results:", ...rows, ...(failed && rerunHint ? [rerunHint] : [])].join("\n");
}
