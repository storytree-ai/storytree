/**
 * Capability 8 · Code survey, read from disk: each story's package in a project's checkout, surveyed.
 * Node only (the app's main process reads it; the page cannot reach the disk).
 *
 * - Main reads an immutable snapshot of fetched origin/main without touching a checkout. An offline
 *   remote keeps the last fetched main; without a fetched main the read fails. Without origin, the
 *   primary folder is read. The map explicitly chooses the current checkout (ADR-0864).
 * - A story's package is the one named after its title ("Session management" is packages/session-management),
 *   but for a story whose package was named otherwise; a story with no such package has no code yet.
 * - A story's package manifests say which other stories' packages it depends on, through any dependency
 *   field: the code's edges between stories, which place the islands in rows (ADR-0840 D2). The app
 *   story includes both its package and desktop manifests, as plan-edges does.
 * - A package's test files outside its src (a test/ folder, say), and the helpers its tests depend on,
 *   are read too: their numbered titles reach source as a test in src would. Helpers outside src stay
 *   within the package and add no source lines; unrelated scripts there are not read.
 * - A package's coverage map (survey-coverage.json beside its src, ADR-0838 D3) is read with its files,
 *   and again only when it changed.
 * - Surveying again reads only what changed (ADR-0836 D2): a file whose size and modified time are as
 *   last read (or the same Git blob) is not read again, an unchanged story keeps its survey, the checkout is
 *   found once per folder without blocking, and one survey of a folder runs at a time.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { surveySourceReader, type SurveySource } from "./survey-source.js";

import type { AnnotatedTree } from "@storytree/library";

import { declaredNumberOf, dependenciesOf, packageOf, surveyStory, type CoverageMap, type SourceFile, type StorySurvey, type SurveyPackage } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The dependency fields of a package.json, in the order their names are listed. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** A package.json's name and the packages it depends on through any field; undefined when it cannot be read. */
function manifestFrom(text: string): { name: string; deps: string[]; exports: SurveyPackage["exports"] } | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.name !== "string") return undefined;
    const deps = DEPENDENCY_FIELDS.flatMap((field) => {
      const named = parsed[field];
      return typeof named === "object" && named !== null ? Object.keys(named) : [];
    });
    const exports = typeof parsed.exports === "string" ? { ".": parsed.exports } : parsed.exports;
    const literal = typeof exports === "object" && exports !== null ? Object.entries(exports).filter(([key, target]) =>
      (key === "." || key.startsWith("./")) && !key.includes("*") && typeof target === "string" && target.startsWith("./")
      && !target.includes("*") && !target.split("/").slice(1).some(part => part === ".." || part === "node_modules"),
    ) as [string, string][] : [];
    return { name: parsed.name, deps: [...new Set(deps)], exports: Object.fromEntries(literal) };
  } catch {
    return undefined;
  }
}

/** The file beside a package's src that holds its coverage map (written by the dev loop's `pnpm survey:coverage`). */
const COVERAGE_MAP = "survey-coverage.json";

export { declaredNumberOf, packageOf };

/** A file's capability, and whether the survey inferred it because the file declares none. */
export interface FileOwner {
  readonly capability: string;
  readonly inferred: boolean;
}

/**
 * ADR-0925 D4's lookup, shared by edit claims and the gate's capability-list check so they never place a
 * file differently: each of `files` (repo-relative to `root`) is placed by its own declaration, else by
 * the code survey's inference of `root`'s current checkout. A file in no story's package, or one
 * `readText` cannot read (undefined or a throw), is placed nowhere. Keys use forward slashes.
 */
export async function capabilitiesOfFiles(root: string, files: readonly string[], tree: AnnotatedTree, {
  readText = (file: string) => readFileSync(path.join(root, file), "utf8"),
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current" }).read(root, plan),
}: { readText?(file: string): string | undefined; survey?(tree: AnnotatedTree): Promise<ProjectSurvey> } = {}): Promise<Map<string, FileOwner>> {
  const owners = new Map<string, FileOwner>();
  const undeclared: string[] = [];
  for (const raw of files) {
    const file = raw.replaceAll("\\", "/");
    const story = tree.stories.find(({ title }) => file.startsWith(`packages/${packageOf(title)}/`) || (packageOf(title) === "app" && file.startsWith("apps/desktop/")));
    if (story === undefined) continue;
    let text: string | undefined;
    try {
      text = readText(file);
    } catch {}
    if (text === undefined) continue;
    const number = declaredNumberOf({ path: file, text }, packageOf(story.title));
    const declared = number === undefined ? undefined : story.capabilities.find(({ title }) => Number(/^\s*(\d+)\s*·/.exec(title)?.[1]) === number);
    if (declared === undefined) undeclared.push(file);
    else owners.set(file, { capability: declared.id, inferred: false });
  }
  if (undeclared.length === 0) return owners;
  const surveyed = await survey(tree);
  const inferred = new Map<string, string>();
  for (const story of tree.stories) {
    const base = `packages/${packageOf(story.title)}`;
    for (const found of surveyed[story.id]?.files ?? []) if (found.capability !== undefined) inferred.set(path.posix.join(base, found.path), found.capability);
  }
  for (const file of undeclared) if (inferred.has(file)) owners.set(file, { capability: inferred.get(file)!, inferred: true });
  return owners;
}

/**
 * The contract numbers the numbered tests in `capability`'s story package carry in `root`'s current
 * checkout, which both front doors skip when they number a new contract; none for a capability `tree`
 * lacks. A title prefixed with another package carries that package's numbers, not these.
 */
export async function testedNumbers(root: string, tree: AnnotatedTree, capability: string, {
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current" }).read(root, plan),
}: { survey?(tree: AnnotatedTree): Promise<ProjectSurvey> } = {}): Promise<string[]> {
  const story = tree.stories.find((one) => one.capabilities.some((part) => part.id === capability));
  if (story === undefined) return [];
  const own = packageOf(story.title);
  const surveyed = await survey({ ...tree, stories: [story] });
  return (surveyed[story.id]?.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || title.package === own).map((title) => title.number));
}

/** A file as last read: kept while its disk fingerprint or Git blob is unchanged. */
type Kept = { readonly version: string; readonly file: SourceFile };

/** Surveys a project's checkout, keeping what it read so that surveying again reads only what changed. */
export interface CodeSurveyReader {
  /** The survey of every story in `tree` whose package the checkout at `folder` holds. */
  read(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey>;
}

/** A coverage map's text, read; an unreadable one allocates nothing. */
function coverageFrom(text: string): CoverageMap {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as CoverageMap) : {};
  } catch {
    return {};
  }
}

export function codeSurveyReader({ readFile: readText = (file: string) => readFile(file, "utf8"), checkout: checkoutScope = "main" }: {
  readFile?(file: string): Promise<string>;
  /** Main reads fetched origin/main; current reads the caller's worktree. Without origin, main reads the primary folder. */
  checkout?: "main" | "current";
} = {}): CodeSurveyReader {
  const sourceAt = surveySourceReader(checkoutScope, readText);
  const kept = new Map<string, Kept>();
  const positioned = new WeakMap<SourceFile, SourceFile>();
  const surveyed = new Map<string, { readonly files: readonly SourceFile[]; readonly capabilities: string; readonly packages: string; readonly survey: StorySurvey }>();
  const running = new Map<string, Promise<ProjectSurvey>>();
  const edged = new Map<string, { readonly base: StorySurvey; readonly survey: StorySurvey }>();

  /** A file at `full`, its path from `root` with forward slashes, read again only if it changed; undefined when there is none. */
  async function fileAt(source: SurveySource, root: string, full: string, seen: Map<string, Kept>, testSupport?: true): Promise<SourceFile | undefined> {
    const found = await source.file(full);
    if (found === undefined) return undefined;
    const { version } = found;
    const last = kept.get(full);
    const now = last !== undefined && last.version === version && last.file.testSupport === testSupport
      ? last
      : { version, file: { path: path.relative(root, full).split(path.sep).join("/"), text: await found.read(), ...(testSupport ? { testSupport } : {}) } };
    seen.set(full, now);
    return now.file;
  }

  /** Every code file under `dir`, its path from `root` with forward slashes, read again only if it changed. */
  async function filesUnder(source: SurveySource, root: string, dir: string, seen: Map<string, Kept>): Promise<SourceFile[]> {
    const entries = await source.entries(dir);
    const found = await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
      const full = path.join(dir, entry.name);
      if (entry.directory) return SKIPPED.has(entry.name) ? [] : filesUnder(source, root, full, seen);
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      const file = await fileAt(source, root, full, seen);
      return file === undefined ? [] : [file];
    }));
    return found.flat();
  }

  /** Candidate paths outside src: enumerate without reading unrelated scripts or leaving the package. */
  async function codeBeside(source: SurveySource, root: string, dir: string): Promise<string[]> {
    const entries = await source.entries(dir);
    const found = await Promise.all(entries.map(async (entry): Promise<string[]> => {
      const full = path.join(dir, entry.name);
      if (entry.directory) return SKIPPED.has(entry.name) || (dir === root && entry.name === "src") ? [] : codeBeside(source, root, full);
      return entry.file && /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
    }));
    return found.flat();
  }

  async function survey(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
    const source = await sourceAt(folder);
    const checkout = source.root;
    const seen = new Map<string, Kept>();
    const surveys = await Promise.all(tree.stories.map(async (story) => {
      const storyPackage = packageOf(story.title);
      const root = path.join(checkout, "packages", storyPackage);
      const sources = await filesUnder(source, root, path.join(root, "src"), seen);
      // The desktop is the app story's frame, just as plan-edges maps it (ADR-0864 D4).
      if (storyPackage === "app") sources.push(...await filesUnder(source, root, path.join(checkout, "apps", "desktop", "src"), seen));
      if (sources.length === 0) return [];
      const beside = await codeBeside(source, root, root);
      const manifestPaths = [path.join(root, "package.json"), ...(storyPackage === "app" ? [path.join(checkout, "apps", "desktop", "package.json")] : [])];
      const manifests = await Promise.all(manifestPaths.map((file) => fileAt(source, root, file, seen)));
      const map = await fileAt(source, root, path.join(root, COVERAGE_MAP), seen);
      const capabilities = JSON.stringify(story.capabilities.map(({ id, title }) => [id, title]));
      const last = surveyed.get(story.id);
      const read = manifests.flatMap((file) => {
        const manifest = file === undefined ? undefined : manifestFrom(file.text);
        return manifest === undefined ? [] : [{ ...manifest, root: path.posix.dirname(path.posix.normalize(`packages/${storyPackage}/${file!.path}`)) + "/" }];
      });
      // Survey in repository coordinates so imports crossing the app/desktop seam can return to
      // packages/app; publish the package-relative paths the forest and map already consume.
      const base = `packages/${storyPackage}`;
      const inCheckout = (file: string) => path.posix.normalize(`${base}/${file}`);
      const inPackage = (file: string) => path.posix.relative(base, file);
      // Keep syntax-cache identities across reads and share them with surveyStory below.
      const inRepository = (file: SourceFile): SourceFile => {
        let located = positioned.get(file);
        if (located === undefined) {
          located = { ...file, path: inCheckout(file.path) };
          positioned.set(file, located);
        }
        return located;
      };
      const outside = new Map(beside.map(full => [path.relative(checkout, full).split(path.sep).join("/"), full]));
      const loaded = new Map(sources.map(file => [inCheckout(file.path), file]));
      const paths = new Set([...loaded.keys(), ...outside.keys()].filter(file => !/\.d\.[cm]?ts$/.test(file)));
      const queue = [...paths].filter(file => TEST_FILE.test(file));
      const visited = new Set(queue);
      for (const name of queue) {
        let file = loaded.get(name);
        if (file === undefined) {
          file = await fileAt(source, root, outside.get(name)!, seen, true);
          if (file === undefined) continue;
          loaded.set(name, file);
          sources.push(file);
        }
        for (const dependency of dependenciesOf(inRepository(file), paths, read)) {
          if (visited.has(dependency)) continue;
          visited.add(dependency);
          queue.push(dependency);
        }
      }
      const files = map === undefined ? sources : [...sources, map];
      const packages = JSON.stringify(read.filter(pkg => Object.keys(pkg.exports).length > 0).map(({ root, name, exports }) => ({ root, name, exports })));
      if (last !== undefined && last.capabilities === capabilities && last.packages === packages && last.files.length === files.length && last.files.every((file, at) => file === files[at])) return [[story.id, last.survey, read] as const];
      const coverage = map === undefined ? {} : coverageFrom(map.text);
      const measured = surveyStory(
        sources.map(inRepository),
        story.capabilities,
        Object.fromEntries(Object.entries(coverage).map(([file, counts]) => [inCheckout(file), counts])),
        storyPackage,
        read,
      );
      const relativeImport = ({ from, to }: { from: string; to: string }) => ({ from: inPackage(from), to: inPackage(to) });
      const fresh: StorySurvey = {
        files: measured.files.map((file) => ({ ...file, path: inPackage(file.path) })),
        imports: measured.imports.map(relativeImport),
        tests: (measured.tests ?? []).map((file) => ({ ...file, path: inPackage(file.path), imports: file.imports.map(relativeImport) })),
      };
      surveyed.set(story.id, { files, capabilities, packages, survey: fresh });
      return [[story.id, fresh, read] as const];
    }));
    // Each story's package dependencies on other stories' packages, by package name.
    const storyOf = new Map(surveys.flat().flatMap(([id, , read]) => read.map(({ name }) => [name, id] as const)));
    const withEdges = surveys.flat().map(([id, base, read]) => {
      if (read.length === 0) return [id, base] as const;
      const dependsOn = [...new Set(read.flatMap(({ deps }) => deps).flatMap((dep) => { const other = storyOf.get(dep); return other === undefined || other === id ? [] : [other]; }))];
      const last = edged.get(id);
      if (last !== undefined && last.base === base && JSON.stringify(last.survey.dependsOn) === JSON.stringify(dependsOn)) return [id, last.survey] as const;
      const survey = { ...base, dependsOn };
      edged.set(id, { base, survey });
      return [id, survey] as const;
    });
    for (const full of kept.keys()) if (full.startsWith(checkout + path.sep) && !seen.has(full)) kept.delete(full);
    for (const [full, now] of seen) kept.set(full, now);
    return Object.fromEntries(withEdges);
  }

  return {
    read(folder, tree) {
      // One survey of a folder at a time: an ask while one runs takes its answer (ADR-0836 D2).
      const now = running.get(folder) ?? survey(folder, tree).finally(() => running.delete(folder));
      running.set(folder, now);
      return now;
    },
  };
}

const shared = codeSurveyReader();

/** The survey of every story in `tree` whose package the checkout at `folder` holds, read through one kept reader. */
export function readCodeSurvey(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
  return shared.read(folder, tree);
}

/**
 * A reader whose surveys run on a worker thread started from `workerFile` (this folder's survey-worker, or a
 * bundle of it), so parsing never holds the asking thread's event loop (8.16). The worker starts on the first ask,
 * keeps its reader between asks, and is started again after it dies; close ends it.
 */
export function offThreadSurveyReader(workerFile: string | URL, options: { execArgv?: string[] } = {}) {
  let worker: Worker | undefined;
  let next = 0;
  const waiting = new Map<number, { resolve: (survey: ProjectSurvey) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const { reject } of waiting.values()) reject(error);
    waiting.clear();
    worker = undefined;
  };
  const started = (): Worker => {
    if (worker !== undefined) return worker;
    const made = new Worker(workerFile, { execArgv: options.execArgv });
    made.unref();
    made.on("message", ({ id, survey, error }: { id: number; survey?: ProjectSurvey; error?: string }) => {
      const asked = waiting.get(id);
      waiting.delete(id);
      if (error === undefined) asked?.resolve(survey!);
      else asked?.reject(new Error(error));
    });
    made.on("error", failAll);
    made.on("exit", (code) => { if (worker === made) failAll(new Error(`the survey worker stopped (exit ${code})`)); });
    worker = made;
    return made;
  };
  return {
    read(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
      return new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        started().postMessage({ id, folder, tree });
      });
    },
    async close(): Promise<void> {
      const stopping = worker;
      worker = undefined;
      await stopping?.terminate();
    },
  };
}
