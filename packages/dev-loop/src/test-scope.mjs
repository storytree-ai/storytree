// Capability 1 · Test scoping. What `pnpm test` runs by default (ADR-0649 D4): only the packages a branch's changes can reach.
// test.mjs runs it, locally and in CI alike, so the two never decide differently.
//
// The changes are the branch against where it left main, merge-base(origin/main, HEAD), plus the
// working tree, untracked files included. Each changed file maps to the workspace package
// (packages/*, apps/*) that holds it. Every package that depends on one of those is added, all the
// way up: by a dependency its package.json declares, or by a relative path in its code that reaches
// into the other package (app-setup builds cli's bin by path, and cli depends on app-setup, not
// the other way round), since neither kind of edge would be seen by the other alone. An evidence
// script (a file under a folder named evidence/) draws no path edge unless something can run it:
// another source file names it or its folder (a test's `evidence/*/build.mjs` glob, a smoke run of
// its capture script), or a script so reached imports it. A capture nothing runs reaching into
// another package by path is not that package's test (increment_71258a385822).
//
// It fails WIDE: whatever the workspace graph cannot account for runs everything. That is a root
// file (README.md, stories/, decisions/, tsconfig.base.json, .github/, ...), any package.json (the
// graph's own input), the lockfile, a file in no package, a package the root workspace depends on
// (the dev loop, whose runner, scoper and gate decide how every test runs, ADR-0805 D4, and the
// packages it runs on), no change at all, and an
// origin/main that cannot be read. Running a suite a change could not reach costs minutes; skipping
// one it could reach merges untested code, so every doubt resolves to the full run. A root path is
// narrowed only once its test-time readers have been measured, never by guessing (0.2's ADR-0394).
// One doubt is settled narrow instead: a path into desktop's renderer reaches desktop's files only (ADR-1141).
//
// A folder under infra/ that holds tests (the library host's backup checks) is a unit too, though no
// package: a change there runs everything, so the full run carries it (increment_e557d7df8a07).

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { resultsTable as baseTable } from "@storytree/base-dev-loop";

const WORKSPACE_ROOTS = ["packages", "apps"];
const INFRA = "infra";
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const RELATIVE_PATH = /["'`](\.{1,2}\/[^"'`$\r\n]*)["'`]/g;
const PATH_TOKEN = /[\w.*-]+(?:\/[\w.*-]+)*\/?/g;
/** A dynamic import or require of a computed path, or a relative path built from a template: imports that cannot be read. */
const UNREADABLE_IMPORT = /\b(?:import|require)\s*\(\s*(?!["'][^"'`]*["']\s*[,)])[^)\s]|`\.{1,2}\/[^`]*\$\{/;
const SPECIFIER = /["'`](@?[\w.-]+(?:\/[\w.-]+)*)["'`]/g;
/** An `import type` or `export type … from`: erased before any test runs, so it reaches nothing a test can fail on (typecheck runs in full). */
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s+from\s*(["'])[^"'\r\n]*\1/g;

/**
 * Checks that a change inside any one package can fail, so every scoped run carries them as units
 * of their own (a full run has them in their package already). The package-boundary check (ADR-0649 D3)
 * is one: a story's code landing in the frame is a change to the frame alone. The code allocation guardrail
 * (ADR-0838 D5) is another: a file left unreached in one package is a change to that package alone.
 */
const ALWAYS_RUN = ["packages/dev-loop/src/package-boundaries.test.mjs", "packages/dev-loop/src/allocation.test.mjs"];

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
  for (const pkg of packages) pkg.deps = pkg.deps.filter((name) => names.has(name));
  const { reaching, sources, kept } = reachingPaths(root, packages);
  const reached = reachedFiles(root, packages, sources, kept);
  for (const pkg of packages) Object.assign(pkg, reachesOf(pkg, packages, reaching, reached));
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

/**
 * Desktop's files whose imports a path reaching them does not follow in full, each with why (ADR-1141,
 * the first exception to ADR-0649 D4's "every doubt runs more"). The renderer mounts every story's surface, so a
 * package bundling it (forest's browser build, the capture kit's) would be a dependent of every story; that the whole
 * renderer bundles is desktop's own test to prove (3.17), so a path into it depends on desktop's files it reaches by
 * relative path, and no further (`own`). So does the page's road worker, which the app's build and the capture kit's both
 * build beside the renderer from the drawing engine: that it builds is desktop's 3.18 and 2.19 to prove. The capture kit's
 * build names the renderer by a repo path the reading cannot
 * see, so it is written here (`targets`), and a path into the renderer's build output stands for the renderer
 * (`builtAt`). Launch's computed import is Playwright's module, outside the workspace (`readable`). A file renamed away leaves its entry unread, and the real-workspace scope test goes red.
 */
const DESKTOP_ONLY = {
  "apps/desktop/src/renderer/renderer.ts": { own: "apps/desktop", builtAt: ["apps/desktop/dist/renderer"] },
  "apps/desktop/src/renderer/road-worker.ts": { own: "apps/desktop" },
  "apps/desktop/src/capture/build.ts": { targets: ["apps/desktop/src/renderer/renderer.ts"] },
  "apps/desktop/src/capture/launch.ts": { readable: true },
};

/**
 * Every source file whose relative paths can reach another file when something runs: its repo-relative
 * path and the repo paths those relative paths resolve to. An evidence script is left out unless a
 * file outside evidence/ names it or its folder, or a script kept imports it.
 */
function reachingPaths(root, packages) {
  const sources = [];
  for (const pkg of packages) {
    const files = globSync("**/*", { cwd: path.join(root, pkg.dir), exclude: (name) => ["node_modules", "dist"].includes(path.basename(String(name))) });
    for (const file of files) {
      if (!SOURCE.test(file)) continue;
      let text;
      try {
        text = readFileSync(path.join(root, pkg.dir, file), "utf8");
      } catch {
        continue; // a directory whose name looks like a source file
      }
      text = withoutComments(text); // a path named only in prose is no read, so rewording a comment moves nothing in or out of scope
      const at = `${pkg.dir}/${file.split(path.sep).join("/")}`;
      const from = path.posix.dirname(at);
      const runs = text.replace(TYPE_ONLY, "");
      const targets = [...runs.matchAll(RELATIVE_PATH)].map(([, relative]) => path.posix.normalize(path.posix.join(from, relative)));
      targets.push(...(DESKTOP_ONLY[at]?.targets ?? []));
      sources.push({ at, targets, evidence: at.split("/").includes("evidence"), text, runs });
    }
  }
  const named = new Set();
  const folders = new Set();
  const globs = new Set();
  for (const source of sources) {
    if (source.evidence) continue;
    for (const [token] of source.text.replace(/\$\{[^}]*\}/g, "*").matchAll(PATH_TOKEN)) {
      const at = token.lastIndexOf("evidence/");
      const tail = (at === 0 || token[at - 1] === "/" ? token.slice(at + "evidence/".length) : token.replace(/^(?:\.\.?\/)+/, "")).replace(/\/$/, "");
      if (!tail) continue;
      if (!tail.includes("*")) {
        if (at >= 0) folders.add(tail);
      } else if (SOURCE.test(tail.split("/").at(-1).replace(/\*/g, ""))) {
        globs.add(tail); // a glob ending in a script's name; a bare ** or * (a comment, a git pathspec) runs nothing
      }
      named.add(tail);
    }
  }
  const bare = (file) => file.replace(SOURCE, "");
  const kept = new Set();
  const pending = [];
  const keep = (source) => {
    if (kept.has(source)) return;
    kept.add(source);
    pending.push(source);
  };
  for (const source of sources) {
    if (!source.evidence) {
      keep(source);
      continue;
    }
    const parts = source.at.split("/");
    const tail = parts.slice(parts.lastIndexOf("evidence") + 1);
    const dirs = tail.slice(0, -1).map((_, at) => tail.slice(0, at + 1).join("/"));
    if (named.has(tail.join("/")) || dirs.some((dir) => folders.has(dir)) || [...globs].some((glob) => path.posix.matchesGlob(tail.join("/"), glob))) keep(source);
  }
  const evidenceByPath = new Map(sources.filter((s) => s.evidence).map((s) => [bare(s.at), s]));
  while (pending.length > 0) {
    for (const target of pending.pop().targets) {
      const imported = evidenceByPath.get(bare(target));
      if (imported) keep(imported);
    }
  }
  return { reaching: [...kept].map(({ at, targets, text }) => ({ at, targets, text })), sources, kept };
}

/** A `/` after one of these, or after one of the words, or at the start, begins a regular expression rather than a division. */
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))$/;

/**
 * The code with its comments blanked (newlines kept), reading strings, template literals and regular expressions
 * as such, so a `//` in a URL or a `/*` in a glob is not taken for a comment.
 */
function withoutComments(text) {
  let out = "";
  let i = 0;
  const braces = []; // for each open `${`, how many plain braces are open inside it
  const copyFrom = (start) => (out += text.slice(start, i));
  /** From just inside a template literal (after its backtick, or after the `}` closing a `${`) to its end or its next `${`. */
  const templateRest = () => {
    const start = i;
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "\\") i += 2;
      else if (text[i] === "$" && text[i + 1] === "{") {
        i += 2;
        braces.push(0);
        return copyFrom(start);
      } else i++;
    }
    i++;
    copyFrom(start);
  };
  while (i < text.length) {
    const c = text[i];
    const start = i;
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ` ${text.slice(start, i).replace(/[^\n]/g, "")}`;
    } else if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c && text[i] !== "\n"; i++) if (text[i] === "\\") i++;
      i++;
      copyFrom(start);
    } else if (c === "`") {
      out += c;
      i++;
      templateRest();
    } else if (c === "/" && BEFORE_REGEX.test(out.trimEnd().slice(-7))) {
      for (let inClass = false, at = i + 1; i < text.length && text[i] !== "\n"; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        else if (text[i] === "/" && !inClass && i >= at) break;
      }
      i++;
      copyFrom(start);
    } else if (c === "}" && braces.at(-1) === 0) {
      braces.pop();
      out += c;
      i++;
      templateRest();
    } else {
      if (braces.length > 0 && (c === "{" || c === "}")) braces[braces.length - 1] += c === "{" ? 1 : -1;
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * What a repo path written in code stands for: the source file it names (an import's `.js` finding
 * its `.ts`), another file in the checkout, or neither (a folder, a build output, a path not on disk). A folder
 * depends on what is under it that something can run: an evidence script nothing runs stays out of it too.
 */
function reachedFiles(root, packages, sources, kept) {
  const bare = (file) => file.replace(SOURCE, "");
  const byPath = new Map(sources.map((s) => [bare(s.at), s]));
  const names = packages.map((p) => [p.name, p.dir]);
  const resolve = (target) => {
    const source = byPath.get(bare(target));
    if (source) return { source };
    try {
      const stat = statSync(path.join(root, target));
      if (stat.isFile()) return { file: target };
      if (stat.isDirectory() && !target.split("/").includes("dist")) return { folder: target };
    } catch {}
    return {};
  };
  /**
   * Each file a reached source can run or read, by relative path or package name, and the packages it reaches whole.
   * Within an `own` dir (a source DESKTOP_ONLY bounds, and what it imports), only relative paths staying in that dir are followed.
   */
  const walk = (source, into, seen, own) => {
    const bound = DESKTOP_ONLY[source.at];
    own ??= bound?.own;
    const key = `${own ?? ""}:${source.at}`; // read narrowly under the renderer, a file is still read in full when reached directly
    if (seen.has(key)) return;
    seen.add(key);
    into.files.add(source.at);
    const ownerDir = packages.find((p) => source.at.startsWith(`${p.dir}/`)).dir;
    if (own === undefined && !bound?.readable && UNREADABLE_IMPORT.test(source.runs)) into.dirs.add(ownerDir);
    for (const target of source.targets) if (own === undefined || target.startsWith(`${own}/`)) reach(target, into, seen, own, source.text);
    if (own !== undefined) return;
    for (const [, specifier] of source.runs.matchAll(SPECIFIER)) {
      const named = names.find(([name]) => specifier === name || specifier.startsWith(`${name}/`));
      if (named) into.dirs.add(named[1]);
    }
  };
  /**
   * What a path depends on: a source and what it imports, a file, everything under a folder, or else its whole package.
   * Under a folder, a script is not followed when the code naming the folder (`from`) shows it reads the folder's data: see readsOnly.
   */
  const reach = (target, into, seen, own, from) => {
    const built = Object.keys(DESKTOP_ONLY).find((at) => DESKTOP_ONLY[at].builtAt?.some((out) => target === out || target.startsWith(`${out}/`)));
    if (built) target = built;
    const { source, file, folder } = resolve(target);
    if (source) walk(source, into, seen, own);
    else if (file) into.files.add(file);
    else if (folder) {
      into.folders.add(`${folder}/`);
      for (const inside of kept) if (inside.at.startsWith(`${folder}/`) && !readsOnly(root, from, folder, inside.at)) walk(inside, into, seen, own);
    } else {
      const owner = packages.find((p) => target === p.dir || target.startsWith(`${p.dir}/`));
      if (owner) into.dirs.add(owner.dir);
    }
  };
  return { reach };
}

const QUOTED = /["'`]([^"'`\r\n]+)["'`]/g;
const dataFiles = new Map();

/**
 * Whether code naming a folder only reads its data, so a script under it is not what the code depends on: it names a file there
 * that is no script (the capture kit's seeds name seed.json.gz and survey.json), and names neither this script's file nor its
 * extension (a glob, a filter), and imports nothing by a computed path. Code that names no file under the folder may run
 * anything there, so it still depends on every script under it.
 */
function readsOnly(root, text, folder, script) {
  const name = path.posix.basename(script);
  const extension = name.slice(name.lastIndexOf("."));
  if (text.includes(name) || new RegExp(`["'\`*]\\${extension}["'\`]`).test(text) || UNREADABLE_IMPORT.test(text)) return false;
  const at = path.join(root, folder);
  if (!dataFiles.has(at)) {
    const files = globSync("**/*", { cwd: at, withFileTypes: true, exclude: (entry) => entry.name === "node_modules" });
    dataFiles.set(at, new Set(files.filter((entry) => entry.isFile() && !SOURCE.test(entry.name)).map((entry) => entry.name)));
  }
  return [...text.matchAll(QUOTED)].some(([, quoted]) => dataFiles.get(at).has(path.posix.basename(quoted)));
}

/**
 * The other packages' dirs that a relative path written in this package's code resolves into
 * (`reaches`), and what this package depends on through those paths (`through`): a path to another
 * package's file depends on that file and whatever it imports, by path or package name, and no more,
 * so a capture reaching desktop's capture kit is not a dependent of all desktop is built from
 * (increment_e6a2a86d876b). A path to a folder depends on what under it something can run (unless the code naming it only
 * reads its data, readsOnly); a build output or anything not on disk depends on the whole package it is in, since what it
 * reads cannot be followed. A type-only import is erased before a test runs, so no path or name in it is followed.
 */
function reachesOf(pkg, packages, reaching, { reach }) {
  const reaches = new Set();
  const through = { files: new Set(), folders: new Set(), dirs: new Set() };
  const seen = new Set();
  for (const { at, targets, text } of reaching) {
    if (!at.startsWith(`${pkg.dir}/`)) continue;
    for (const target of targets) {
      const owner = packages.find((p) => p !== pkg && (target === p.dir || target.startsWith(`${p.dir}/`)));
      if (!owner) continue;
      reaches.add(owner.dir);
      reach(target, through, seen, undefined, text);
    }
  }
  through.dirs.delete(pkg.dir);
  const sorted = (set) => [...set].sort();
  return { reaches: sorted(reaches), through: { files: sorted(through.files), folders: sorted(through.folders), dirs: sorted(through.dirs) } };
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
  for (const pkg of workspace) {
    const { files = [], folders = [] } = pkg.through ?? {};
    if (changed.some((file) => files.includes(file) || folders.some((folder) => file.startsWith(folder)))) selected.add(pkg.dir);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const pkg of workspace) {
      if (selected.has(pkg.dir)) continue;
      const uses = [...pkg.deps.map((name) => workspace.find((p) => p.name === name)?.dir), ...(pkg.through?.dirs ?? [])];
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

/** What `pnpm run test --help` prints: the runner's flags, and what else it takes. */
export const TEST_USAGE = `pnpm test: run the tests this branch's changes can reach, against a throwaway Postgres.

  pnpm test                        run what the branch's changes can reach (the first line, scope:, says what)
  pnpm run test --scope            print the decision and the units, and run nothing
  pnpm run test --full             run everything, whatever changed
  pnpm run test --only=cli,forest  run the named packages (dir, dir name or package name) or infra folders (dir)
  pnpm run test --rerun-failed     run what the last run in this checkout failed or never reached
  pnpm run test --jobs=<n>         test n units at once (else STORYTREE_TEST_JOBS, else 2, a core left free, or 1 on Windows arm64); 1 runs them one by one
  pnpm run test <files>            run just those files, as one unit
  pnpm run test --set-limit=<unit>=<seconds> --reason="..."   set a unit's deadline on this machine
  pnpm run test --clear-limit=<unit>                          clear it again
  pnpm run test --help             print this

node --test's own options (--test-name-pattern=..., --test-only, ...) go to every unit; give them in --name=value form.`;

/**
 * The runner's command line: its own flags, and what goes on to `node --test` (files, and node's
 * --test-* options). `help` asks for the usage; `refusal` names an unknown flag and the known ones.
 * Both end the run before the heavy-run lock or a Postgres is taken.
 */
export function parseTestArgs(argv) {
  const flags = { full: false, scope: false, rerunFailed: false, only: [], setLimit: undefined, clearLimit: undefined, reason: undefined, jobs: undefined };
  const testArgs = [];
  let help = false;
  let refusal;
  for (const arg of argv) {
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--full") flags.full = true;
    else if (arg === "--scope") flags.scope = true;
    else if (arg === "--rerun-failed") flags.rerunFailed = true;
    else if (arg.startsWith("--only=")) flags.only.push(...arg.slice("--only=".length).split(",").filter(Boolean));
    else if (arg.startsWith("--set-limit=")) flags.setLimit = arg.slice("--set-limit=".length);
    else if (arg.startsWith("--clear-limit=")) flags.clearLimit = arg.slice("--clear-limit=".length);
    else if (arg.startsWith("--reason=")) flags.reason = arg.slice("--reason=".length);
    else if (arg.startsWith("--jobs=")) flags.jobs = arg.slice("--jobs=".length);
    else if (!arg.startsWith("-") || /^--(experimental-)?test-/.test(arg)) testArgs.push(arg);
    else refusal ??= `unknown flag ${arg}; the known ones are --full, --scope, --only=<packages>, --rerun-failed, --jobs=<n>, --set-limit=, --clear-limit=, --reason=, --help, and node --test's --test-* options`;
  }
  return { flags, testArgs, help, refusal };
}

/**
 * The units a run executes, after the flags: `full` forces everything, `only` names packages (by
 * dir, dir name or package name), and `rerunFailed` takes the units the last recorded
 * run failed or never reached. Returns the decision as it now stands and the unit list.
 */
/**
 * Test files that run as a unit of their own, after every other unit has ended and with nothing
 * beside them, whenever their package runs; their package's unit runs its other files. Forest's
 * browser proof: its software-GL frames starve when other units and files share a 3-CPU macOS
 * runner (load average 42 in run 38038938459; arc_2a8dbc47a5f9, increment_ba747f54277d), and its
 * 15 s no-new-frame wait is not widened instead. The world's road-reveal proof likewise: on macOS it
 * took 12-15 s in most merge queue runs, but 76 s in one and past its 80 s bound in another (runs 38092380077 and
 * 38032277103; increment_58dcb2d5c9a5). Knowledge-core's traversal proof too: beside other units on macOS it took 72 s in one
 * run and was killed past 180 s in four others (run 39187115227 among them; increment_724389f3f21d). The desktop's named-surfaces
 * proof drives the whole renderer's globe too: about 14 s alone, it pushed its package's unit past 60 s beside the
 * gate's other units on the Mint box (increment_2fd57d63cfae).
 */
export const ALONE = ["packages/forest/src/view/desktop-renderer-smoke.test.ts", "packages/forest-world/src/planet/road-reveal.test.ts",
  "packages/knowledge-core/src/traversal-smoke.test.ts", "apps/desktop/src/renderer/named-surfaces.test.ts"];

/** The units with each file to run alone whose package is among them added after them as its own. */
function withAlone(root, units, alone) {
  const own = alone.filter((file) => !units.includes(file) && units.some((unit) => file.startsWith(`${unit}/`)) && existsSync(path.join(root, file)));
  return [...units, ...own];
}

export function planRun({ root, workspace, decision, flags = {}, record, alone = ALONE }) {
  const infra = infraUnits(root);
  const all = [...workspace.filter((p) => hasTests(root, p.dir)).map((p) => p.dir), ...infra];
  if (flags.full) decision = full("--full asked for everything");
  if (flags.only?.length) {
    const units = flags.only.map((wanted) => {
      if (infra.includes(wanted)) return wanted;
      const pkg = workspace.find((p) => wanted === p.dir || wanted === p.name || wanted === path.posix.basename(p.dir));
      if (pkg === undefined) throw new Error(`--only ${wanted}: no workspace package or infra folder by that dir or name`);
      return pkg.dir;
    });
    const dirs = [...new Set(units)].sort();
    return { decision: { mode: "only", dirs, reason: "--only named them" }, units: withAlone(root, dirs.filter((u) => all.includes(u)), alone) };
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
  if (decision.mode === "full") return { decision, units: withAlone(root, all, alone) };
  const always = ALWAYS_RUN.filter((file) => existsSync(path.join(root, file)));
  return { decision, units: withAlone(root, [...decision.dirs.filter((dir) => all.includes(dir)), ...always], alone) };
}

/**
 * The test files a unit runs, as the globs node --test is given: a unit may be one file. A package
 * holding a file to run alone names its other files instead, since a glob cannot leave one out.
 */
export function unitGlobs(unit, { root, alone = ALONE } = {}) {
  if (/\.test\.m?[jt]s$/.test(unit)) return [unit];
  if (unit.startsWith(`${INFRA}/`)) return [`${unit}/**/*.test.ts`, `${unit}/**/*.test.mjs`];
  const globs = [`${unit}/src/**/*.test.ts`, `${unit}/src/**/*.test.mjs`];
  if (root === undefined || !alone.some((file) => file.startsWith(`${unit}/`))) return globs;
  return globSync(globs, { cwd: root, exclude: (name) => path.basename(String(name)) === "node_modules" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !alone.includes(file))
    .sort();
}

/** The folders under infra/ holding test files, each a unit: infra code has no src/ of its own. */
function infraUnits(root) {
  let entries = [];
  try {
    entries = readdirSync(path.join(root, INFRA), { withFileTypes: true });
  } catch {}
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${INFRA}/${entry.name}`)
    .filter((dir) => globSync(`${dir}/**/*.test.{ts,mjs}`, { cwd: root, exclude: (name) => path.basename(String(name)) === "node_modules" }).length > 0)
    .sort();
}

function hasTests(root, dir) {
  return globSync(`${dir}/src/**/*.test.{ts,mjs}`, { cwd: root, exclude: (name) => path.basename(String(name)) === "node_modules" }).length > 0;
}

/** Each unit's result, PASS, FAIL or NOT RUN: the base dev loop's table, with the test runner's rerun hint unless a caller replaces or omits it. */
export function resultsTable(results, { reasons = {}, rerunHint = "rerun only these: pnpm run test --rerun-failed" } = {}) {
  return baseTable(results, { reasons, rerunHint });
}
