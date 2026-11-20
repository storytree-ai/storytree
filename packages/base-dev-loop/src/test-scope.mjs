// Capability 2 · Test scoping

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const WORKSPACE_ROOTS = ["packages", "apps"];
const INFRA = "infra";
const DOCS = "docs/";
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const RELATIVE_PATH = /["'`](\.{1,2}\/[^"'`$\r\n]*)["'`]/g;
const ROOTED = /\b(?:join|resolve)\(\s*[\w.]+(?:\(\))?\s*,\s*((?:["'`][^"'`$\r\n]*["'`]\s*,\s*)*["'`][^"'`$\r\n]*["'`])/g;
const LITERAL = /["'`]([^"'`$\r\n]*)["'`]/g;
const PATH_TOKEN = /[\w.*-]+(?:\/[\w.*-]+)*\/?/g;
const UNREADABLE_IMPORT = /\b(?:import|require)\s*\(\s*(?!["'][^"'`]*["']\s*[,)])[^)\s]|`\.{1,2}\/[^`]*\$\{/;
const SPECIFIER = /["'`](@?[\w.-]+(?:\/[\w.-]+)*)["'`]/g;
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s+from\s*(["'])[^"'\r\n]*\1/g;

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
  for (const pkg of packages) pkg.runsPage = runsPage(pkg, sources);
  packages.sort((a, b) => (a.dir < b.dir ? -1 : 1));
  packages.renderer = rendererClosure(packages, reached);
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

const RENDERER = "apps/desktop/src/renderer/renderer.ts";
const DESKTOP_ONLY = {
  [RENDERER]: { own: "apps/desktop", builtAt: ["apps/desktop/dist/renderer"] },
  "apps/desktop/src/renderer/road-worker.ts": { own: "apps/desktop" },
  "apps/desktop/src/renderer/page-build.ts": { own: "apps/desktop" },
  "apps/desktop/src/capture/build.ts": { targets: ["apps/desktop/src/renderer/renderer.ts"] },
  "apps/desktop/src/capture/launch.ts": { readable: true },
};

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
        continue;
      }
      text = withoutComments(text);
      const at = `${pkg.dir}/${file.split(path.sep).join("/")}`;
      const from = path.posix.dirname(at);
      const runs = text.replace(TYPE_ONLY, "");
      const targets = [...runs.matchAll(RELATIVE_PATH)].map(([, relative]) => path.posix.normalize(path.posix.join(from, relative)));
      targets.push(...(DESKTOP_ONLY[at]?.targets ?? []));
      sources.push({ at, targets, reads: rootReads(root, runs), evidence: at.split("/").includes("evidence"), text, runs });
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
        globs.add(tail);
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
  return { reaching: [...kept].map(({ at, targets, reads, text }) => ({ at, targets, reads, text })), sources, kept };
}

function rootReads(root, runs) {
  const reads = new Set();
  for (const [, run] of runs.matchAll(ROOTED)) {
    const joined = path.posix.normalize([...run.matchAll(LITERAL)].map(([, segment]) => segment).join("/"));
    if (!WORKSPACE_ROOTS.some((base) => joined.startsWith(`${base}/`))) continue;
    try {
      if (statSync(path.join(root, joined)).isFile()) reads.add(joined);
    } catch {}
  }
  return [...reads];
}

const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))$/;

function withoutComments(text) {
  let out = "";
  let i = 0;
  const braces = [];
  const copyFrom = (start) => (out += text.slice(start, i));
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
  let whole = false;
  const walk = (source, into, seen, own) => {
    const bound = whole ? undefined : DESKTOP_ONLY[source.at];
    own ??= bound?.own;
    const key = `${own ?? ""}:${source.at}`;
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
  const bundled = () => {
    const into = { files: new Set(), folders: new Set(), dirs: new Set() };
    const renderer = byPath.get(bare(RENDERER));
    whole = true;
    try {
      if (renderer) walk(renderer, into, new Set());
    } finally {
      whole = false;
    }
    return into;
  };
  return { reach, bundled };
}

function rendererClosure(packages, { bundled }) {
  const { files, folders, dirs } = bundled();
  const ownerOf = (file) => packages.find((p) => file.startsWith(`${p.dir}/`))?.dir;
  const closure = new Set([...dirs, ...[...files, ...folders].map(ownerOf)].filter(Boolean));
  for (let grew = true; grew; ) {
    grew = false;
    for (const pkg of packages) {
      if (!closure.has(pkg.dir)) continue;
      for (const dir of [...pkg.deps.map((name) => packages.find((p) => p.name === name)?.dir), ...pkg.through.dirs]) {
        if (dir && !closure.has(dir)) {
          closure.add(dir);
          grew = true;
        }
      }
    }
  }
  return [...closure].sort();
}

const LAUNCHERS = {
  "apps/desktop/src/capture/index.ts": ["launch", "runCapture", "withCapture"],
  "apps/desktop/src/capture/runner.ts": ["runCapture", "withCapture"],
  "apps/desktop/src/capture/launch.ts": ["launch"],
};
const NAMED_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"'\r\n]*)["']/g;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

function runsPage(pkg, sources) {
  const bare = (file) => file.replace(SOURCE, "");
  const own = sources.filter((s) => s.at.startsWith(`${pkg.dir}/`));
  const byPath = new Map(own.map((s) => [bare(s.at), s]));
  const importsLauncher = (source) =>
    [...source.runs.matchAll(NAMED_IMPORT)].some(([, names, relative]) => {
      const launchers = LAUNCHERS[`${bare(path.posix.join(path.posix.dirname(source.at), relative))}.ts`] ?? [];
      return names.split(",").some((name) => launchers.includes(name.trim().split(/(?<!\s)\s+as\s+/)[0]));
    });
  const launches = (source, seen = new Set()) => {
    if (seen.has(source)) return false;
    seen.add(source);
    return importsLauncher(source) || source.targets.some((target) => byPath.has(bare(target)) && launches(byPath.get(bare(target)), seen));
  };
  const names = (test, script) => {
    const within = script.at.slice(pkg.dir.length + 1);
    const folder = path.posix.dirname(within);
    return test.text.includes(path.posix.basename(within)) && (folder === "." || test.text.includes(folder));
  };
  const tests = own.filter((s) => TEST_FILE.test(s.at));
  return tests.some((test) => launches(test) || own.some((script) => !TEST_FILE.test(script.at) && names(test, script) && launches(script)));
}

const QUOTED = /["'`]([^"'`\r\n]+)["'`]/g;
const dataFiles = new Map();

function readsOnly(root, text, folder, script) {
  const name = path.posix.basename(script);
  const extension = name.slice(name.lastIndexOf("."));
  if (text.includes(name) || new RegExp(`["'\`*]${extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(text) || UNREADABLE_IMPORT.test(text)) return false;
  const at = path.join(root, folder);
  if (!dataFiles.has(at)) {
    const files = globSync("**/*", { cwd: at, withFileTypes: true, exclude: (entry) => entry.name === "node_modules" });
    dataFiles.set(at, new Set(files.filter((entry) => entry.isFile() && !SOURCE.test(entry.name)).map((entry) => entry.name)));
  }
  return [...text.matchAll(QUOTED)].some(([, quoted]) => dataFiles.get(at).has(path.posix.basename(quoted)));
}

function reachesOf(pkg, packages, reaching, { reach }) {
  const reaches = new Set();
  const through = { files: new Set(), folders: new Set(), dirs: new Set() };
  const seen = new Set();
  for (const { at, targets, reads, text } of reaching) {
    if (!at.startsWith(`${pkg.dir}/`)) continue;
    for (const file of reads) {
      const owner = packages.find((p) => p !== pkg && file.startsWith(`${p.dir}/`));
      if (!owner) continue;
      reaches.add(owner.dir);
      through.files.add(file);
    }
    for (const target of targets) {
      if (target.startsWith(DOCS)) {
        through.files.add(target);
        through.folders.add(`${target.replace(/\/$/, "")}/`);
        continue;
      }
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

export function classify(files, workspace) {
  const changed = files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean);
  if (changed.length === 0) return full("no change against origin/main, so nothing narrows the run");
  const touched = new Set();
  const docs = changed.filter((file) => file.startsWith(DOCS));
  for (const file of changed) {
    if (file.startsWith(DOCS)) continue;
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
  const readers = new Set();
  for (const pkg of workspace) {
    const { files = [], folders = [] } = pkg.through ?? {};
    const reads = (file) => files.includes(file) || folders.some((folder) => file.startsWith(folder));
    if (changed.some(reads)) selected.add(pkg.dir);
    if (docs.some(reads) && !touched.has(pkg.dir)) readers.add(pkg.dir);
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
  const renders = [...touched].some((dir) => workspace.renderer?.includes(dir));
  const runners = renders ? workspace.filter((p) => p.runsPage && !selected.has(p.dir)).map((p) => p.dir) : [];
  for (const dir of runners) selected.add(dir);
  const dirs = [...selected].sort();
  const dependents = dirs.filter((dir) => !touched.has(dir) && !readers.has(dir) && !runners.includes(dir));
  const parts = [];
  if (touched.size) parts.push(`changed: ${[...touched].sort().join(", ")}`);
  if (docs.length) parts.push(`${docs.length} under docs/, ${readers.size ? `read by ${[...readers].sort().join(", ")}` : "which no test reads"}`);
  if (dependents.length) parts.push(`their dependents: ${dependents.join(", ")}`);
  if (runners.length) parts.push(`running the page the renderer bundles: ${runners.sort().join(", ")}`);
  const reason = parts.join("; ");
  return { mode: "affected", dirs, reason };
}

function full(reason) {
  return { mode: "full", reason };
}

export function changedFiles(root, base = "origin/main") {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const lines = (text) => text.split("\n").filter(Boolean);
  const tracked = lines(git("diff", "--name-only", "--no-renames", "-z", mergeBase).replaceAll("\0", "\n"));
  const untracked = lines(git("ls-files", "--others", "--exclude-standard", "-z").replaceAll("\0", "\n"));
  return [...new Set([...tracked, ...untracked])];
}

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

export function scopeLine(decision) {
  const what = decision.mode === "full" ? "everything" : decision.dirs.join(", ") || "nothing";
  return `scope: ${decision.mode} — ${what} — ${decision.reason}`;
}

export const TEST_USAGE = `pnpm test: run the tests this branch's changes can reach, against a throwaway Postgres.

  pnpm test                        run what the branch's changes can reach (the first line, scope:, says what)
  pnpm run test --scope            print the decision and the units, and run nothing
  pnpm run test --full             run everything, whatever changed
  pnpm run test --only=cli,forest  run the named packages (dir, dir name or package name) or infra folders (dir)
  pnpm run test --rerun-failed     run what the last run in this checkout failed or never reached
  pnpm run test --jobs=<n>         test n units at once (else STORYTREE_TEST_JOBS, else 2, a core left free, or 1 on Windows arm64); 1 runs them one by one
  pnpm run test <files>            run just those files, as one unit
  pnpm run test <package folders>  run those packages, as --only would
  pnpm run test --set-limit=<unit>=<seconds> --reason="..."   set a unit's deadline on this machine
  pnpm run test --clear-limit=<unit>                          clear it again
  pnpm run test --help             print this

node --test's own options (--test-name-pattern=..., --test-only, ...) go to every unit; give them in --name=value form.`;

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

export function namedFolders({ root, workspace, testArgs }) {
  const only = [];
  const rest = [];
  let refusal;
  for (const arg of testArgs) {
    let folder = false;
    try {
      folder = !arg.startsWith("-") && statSync(path.resolve(root, arg)).isDirectory();
    } catch {}
    if (!folder) {
      rest.push(arg);
      continue;
    }
    const dir = path.relative(root, path.resolve(root, arg)).split(path.sep).join("/");
    if (workspace.some((p) => p.dir === dir) || infraUnits(root).includes(dir)) only.push(dir);
    else refusal ??= `${arg} is a folder, not a package: name test files, or a package's folder to run that package (plain pnpm test scopes by the branch's changes)`;
  }
  if (only.length > 0 && rest.some((arg) => !arg.startsWith("-"))) refusal ??= "name test files or package folders, not both";
  return { only, testArgs: rest, refusal };
}

function withAlone(root, units, alone) {
  const own = alone.filter((file) => !units.includes(file) && units.some((unit) => file.startsWith(`${unit}/`)) && existsSync(path.join(root, file)));
  return [...units, ...own];
}

export function planRun({ root, workspace, decision, flags = {}, record, alone = [], alwaysRun = [] }) {
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
  const always = alwaysRun.filter((file) => existsSync(path.join(root, file)));
  return { decision, units: withAlone(root, [...decision.dirs.filter((dir) => all.includes(dir)), ...always], alone) };
}

export function unitGlobs(unit, { root, alone = [] } = {}) {
  if (/\.test\.m?[jt]s$/.test(unit)) return [unit];
  if (unit.startsWith(`${INFRA}/`)) return [`${unit}/**/*.test.ts`, `${unit}/**/*.test.mjs`];
  const globs = [`${unit}/src/**/*.test.ts`, `${unit}/src/**/*.test.mjs`];
  if (root === undefined || !alone.some((file) => file.startsWith(`${unit}/`))) return globs;
  return globSync(globs, { cwd: root, exclude: (name) => path.basename(String(name)) === "node_modules" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !alone.includes(file))
    .sort();
}

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

export const RERUN_HINT = "rerun only these: pnpm run test --rerun-failed";
