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
 * - A mapped story is read from the folder this machine imports it from, as mapped-survey.ts reads it
 *   (ADR-0993 D2), never from the checkout's packages. A story's package dependency on a mapped story's
 *   package is a road to it, as one on another story's package is (ADR-0993 D8).
 * - A reader given a keep folder keeps each checkout's last survey of a fetched main there, by commit, plan and
 *   survey code: a start that finds main unmoved and the plan the same answers from it, reading and parsing no
 *   file (8.25). A commit is immutable, so a kept survey cannot be stale. A plan with mapped stories is not kept:
 *   an imported folder can change without a commit.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { manifestFrom, SKIPPED, surveySourceReader, type SurveySource } from "./survey-source.js";
import { mappedSurveyReader, type ImportedFolder } from "./mapped-survey.js";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { ALSO_OWNED, declaredNumberOf, declaresTitle, dependenciesOf, packageOf, packagesOf, storyEdges, surveyStory, type CoverageMap, type SourceFile, type SurveyPackage } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The file beside a package's src that holds its coverage map (written by the dev loop's `pnpm survey:coverage`). */
const COVERAGE_MAP = "survey-coverage.json";

export { declaredNumberOf, packageOf, packagesOf };

/** The packages stories own beyond their own, by their own package's folder name (ADR-1066 D3). */
type AlsoOwned = Readonly<Record<string, readonly string[]>>;

/** A file's capability, and whether the survey inferred it because the file declares none. */
export interface FileOwner {
  readonly capability: string;
  readonly inferred: boolean;
}

/**
 * ADR-0925 D4's lookup, shared by edit claims and the gate's capability-list check so they never place a
 * file differently: each of `files` (repo-relative to `root`) is placed by its own declaration, else by
 * the code survey's inference of `root`'s current checkout. A source file's header declares only when it names
 * the title of the capability its number does in the file's story (8.29); a file in any package its story owns is its (8.30). A file in no story's package, or one
 * `readText` cannot read (undefined or a throw), is placed nowhere. Keys use forward slashes.
 */
export async function capabilitiesOfFiles(root: string, files: readonly string[], tree: AnnotatedTree, {
  readText = (file: string) => readFileSync(path.join(root, file), "utf8"),
  alsoOwned = ALSO_OWNED,
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current", alsoOwned }).read(root, plan),
}: { readText?(file: string): string | undefined; alsoOwned?: AlsoOwned; survey?(tree: AnnotatedTree): Promise<ProjectSurvey> } = {}): Promise<Map<string, FileOwner>> {
  const owners = new Map<string, FileOwner>();
  const undeclared: string[] = [];
  for (const raw of files) {
    const file = raw.replaceAll("\\", "/");
    const story = tree.stories.find((candidate) => candidate.mapped === undefined && (packagesOf(candidate, alsoOwned).some((name) => file.startsWith(`packages/${name}/`)) || (packageOf(candidate) === "app" && file.startsWith("apps/desktop/"))));
    if (story === undefined) continue;
    let text: string | undefined;
    try {
      text = readText(file);
    } catch {}
    if (text === undefined) continue;
    const number = declaredNumberOf({ path: file, text }, packagesOf(story, alsoOwned));
    const numbered = number === undefined ? undefined : story.capabilities.find(({ title }) => Number(/^\s*(\d+)\s*·/.exec(title)?.[1]) === number);
    // A source file's header must name the capability its number does here; a test file's numbers carry no title.
    const declared = numbered !== undefined && (TEST_FILE.test(file) || declaresTitle(text, numbered.title)) ? numbered : undefined;
    if (declared === undefined) undeclared.push(file);
    else owners.set(file, { capability: declared.id, inferred: false });
  }
  if (undeclared.length === 0) return owners;
  const surveyed = await survey(tree);
  const inferred = new Map<string, string>();
  for (const story of tree.stories) {
    const base = `packages/${packageOf(story)}`;
    for (const found of surveyed[story.id]?.files ?? []) if (found.capability !== undefined) inferred.set(path.posix.join(base, found.path), found.capability);
  }
  for (const file of undeclared) if (inferred.has(file)) owners.set(file, { capability: inferred.get(file)!, inferred: true });
  return owners;
}

/**
 * The contract numbers the numbered tests in `capability`'s story package carry in `root`'s current
 * checkout, which both front doors skip when they number a new contract, from every package the story owns; none for a
 * capability `tree` lacks. A title prefixed with another story's package carries that package's numbers, not these.
 */
export async function testedNumbers(root: string, tree: AnnotatedTree, capability: string, {
  alsoOwned = ALSO_OWNED,
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current", alsoOwned }).read(root, plan),
}: { alsoOwned?: AlsoOwned; survey?(tree: AnnotatedTree): Promise<ProjectSurvey> } = {}): Promise<string[]> {
  const story = tree.stories.find((one) => one.capabilities.some((part) => part.id === capability));
  if (story === undefined) return [];
  const own = packagesOf(story, alsoOwned);
  const surveyed = await survey({ ...tree, stories: [story] });
  return (surveyed[story.id]?.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || own.includes(title.package)).map((title) => title.number));
}

/**
 * The titles of `capability`'s planned contracts whose number none of `tested` carries (the numbers
 * {@link testedNumbers} reads), in plan order; none for a capability `tree` lacks.
 */
export function untestedContracts(tree: AnnotatedTree, capability: string, tested: readonly string[]): string[] {
  const proven = new Set(tested);
  const contracts = tree.stories.flatMap((story) => story.capabilities).find((part) => part.id === capability)?.contracts ?? [];
  return contracts.map((contract) => contract.title).filter((title) => {
    const number = /^(\d+\.\d+) · /.exec(title)?.[1];
    return number !== undefined && !proven.has(number);
  });
}

/** A file as last read: kept while its disk fingerprint or Git blob is unchanged. */
type Kept = { readonly version: string; readonly file: SourceFile };

/** Surveys a project's checkout, keeping what it read so that surveying again reads only what changed. */
export interface CodeSurveyReader {
  /**
   * The survey of every story in `tree` whose package the checkout at `folder` holds, and of every mapped story
   * whose import is among `imports`, the folders this machine imports (ADR-0993 D2).
   */
  read(folder: string, tree: AnnotatedTree, imports?: readonly ImportedFolder[]): Promise<ProjectSurvey>;
}

export type { ImportedFolder };

/** A coverage map's text, read; an unreadable one allocates nothing. */
function coverageFrom(text: string): CoverageMap {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as CoverageMap) : {};
  } catch {
    return {};
  }
}

/** Where a reader keeps its surveys between starts, and what names the code that surveyed them: a survey kept by other code is not used. */
export interface SurveyKeep {
  readonly folder: string;
  readonly code: string;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

/** The kept survey of the checkout at `root` for `key`, if the keep holds one; a missing or unreadable keep holds none. */
async function keptSurvey(file: string, key: string): Promise<ProjectSurvey | undefined> {
  try {
    const kept = JSON.parse(await readFile(file, "utf8")) as { key?: unknown; survey?: ProjectSurvey };
    return kept.key === key ? kept.survey : undefined;
  } catch {
    return undefined;
  }
}

/** Keep `survey` for `key`, replacing the checkout's last; a keep that cannot be written leaves the survey answered all the same. */
async function keepSurvey(file: string, key: string, survey: ProjectSurvey): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const writing = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(writing, JSON.stringify({ key, survey }));
    await rename(writing, file);
  } catch {}
}

export function codeSurveyReader({ readFile: readText = (file: string) => readFile(file, "utf8"), checkout: checkoutScope = "main", keep, startFromFetched = false, alsoOwned = ALSO_OWNED }: {
  readFile?(file: string): Promise<string>;
  /** The packages stories own beyond the one named after their title (8.30); by default, those package-of.ts declares. */
  alsoOwned?: AlsoOwned;
  /** Main reads fetched origin/main; current reads the caller's worktree. Without origin, main reads the primary folder. */
  checkout?: "main" | "current";
  /** Where surveys of a fetched main are kept between starts (8.25); without it nothing is kept. */
  keep?: SurveyKeep;
  /**
   * A start's reader (8.27): its first ask of a repository is answered from the main already fetched, when there is one, while
   * it fetches; its next ask waits on that fetch and surveys what it brought. Without it, every ask waits on its own fetch.
   */
  startFromFetched?: boolean;
} = {}): CodeSurveyReader {
  const sourceAt = surveySourceReader(checkoutScope, readText, startFromFetched);
  const kept = new Map<string, Kept>();
  const positioned = new WeakMap<SourceFile, SourceFile>();
  const surveyed = new Map<string, { readonly files: readonly SourceFile[]; readonly capabilities: string; readonly packages: string; readonly survey: StorySurvey }>();
  const running = new Map<string, Promise<ProjectSurvey>>();
  const edged = new Map<string, { readonly base: StorySurvey; readonly survey: StorySurvey }>();
  const mappedReader = mappedSurveyReader(readText);

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

  /** The checkout's last kept survey by its file, and the key it was kept for: written again only when that changes. */
  const keptKeys = new Map<string, string>();

  async function survey(folder: string, tree: AnnotatedTree, imports: readonly ImportedFolder[]): Promise<ProjectSurvey> {
    const source = await sourceAt(folder);
    const checkout = source.root;
    const keeping = keep === undefined || source.commit === undefined || tree.stories.some((story) => story.mapped !== undefined) ? undefined : {
      file: path.join(keep.folder, `${hashOf(checkout).slice(0, 16)}.json`),
      key: hashOf(JSON.stringify([keep.code, source.commit, tree.stories.map(({ id, title, capabilities }) => [id, title, capabilities.map((part) => [part.id, part.title])])])),
    };
    if (keeping !== undefined) {
      const found = keptKeys.get(keeping.file) === keeping.key || !keptKeys.has(keeping.file) ? await keptSurvey(keeping.file, keeping.key) : undefined;
      if (found !== undefined) {
        keptKeys.set(keeping.file, keeping.key);
        return found;
      }
    }
    const seen = new Map<string, Kept>();
    const mapped = mappedReader.read(tree.stories, imports);
    mapped.catch(() => {}); // Awaited below; a failure there is the survey's.
    const surveys = await Promise.all(tree.stories.filter((story) => story.mapped === undefined).map(async (story) => {
      // Every package the story owns is read, each path from the one named after its title (8.30).
      const owned = packagesOf(story, alsoOwned);
      const storyPackage = owned[0]!;
      const root = path.join(checkout, "packages", storyPackage);
      const roots = owned.map((name) => path.join(checkout, "packages", name));
      const sources = (await Promise.all(roots.map((dir) => filesUnder(source, root, path.join(dir, "src"), seen)))).flat();
      // The desktop is the app story's frame, just as plan-edges maps it (ADR-0864 D4).
      if (storyPackage === "app") sources.push(...await filesUnder(source, root, path.join(checkout, "apps", "desktop", "src"), seen));
      if (sources.length === 0) return [];
      const beside = (await Promise.all(roots.map((dir) => codeBeside(source, dir, dir)))).flat();
      const manifestPaths = [...roots.map((dir) => path.join(dir, "package.json")), ...(storyPackage === "app" ? [path.join(checkout, "apps", "desktop", "package.json")] : [])];
      const manifests = await Promise.all(manifestPaths.map((file) => fileAt(source, root, file, seen)));
      const maps = await Promise.all(roots.map((dir) => fileAt(source, root, path.join(dir, COVERAGE_MAP), seen)));
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
      const files = [...sources, ...maps.flatMap((map) => map === undefined ? [] : [map])];
      const packages = JSON.stringify(read.filter(pkg => Object.keys(pkg.exports).length > 0 || Object.keys(pkg.imports).length > 0).map(({ root, name, exports, imports }) => ({ root, name, exports, imports })));
      if (last !== undefined && last.capabilities === capabilities && last.packages === packages && last.files.length === files.length && last.files.every((file, at) => file === files[at])) return [[story.id, last.survey, read, sources.map(inRepository), base] as const];
      // Each package's coverage map is keyed from its own folder.
      const coverage = Object.fromEntries(maps.flatMap((map, at) => map === undefined ? [] : Object.entries(coverageFrom(map.text)).map(([file, counts]) => [path.posix.normalize(`packages/${owned[at]}/${file}`), counts] as const)));
      const measured = surveyStory(sources.map(inRepository), story.capabilities, coverage, owned, read);
      const relativeImport = ({ from, to }: { from: string; to: string }) => ({ from: inPackage(from), to: inPackage(to) });
      const fresh: StorySurvey = {
        files: measured.files.map((file) => ({ ...file, path: inPackage(file.path) })),
        imports: measured.imports.map(relativeImport),
        tests: (measured.tests ?? []).map((file) => ({ ...file, path: inPackage(file.path), imports: file.imports.map(relativeImport) })),
      };
      surveyed.set(story.id, { files, capabilities, packages, survey: fresh });
      return [[story.id, fresh, read, sources.map(inRepository), base] as const];
    }));
    // Each story's package dependencies on other stories' packages, by package name: a mapped story's too, so a
    // built package that imports one has a road to it (ADR-0993 D8).
    const mappedRead = await mapped;
    const storyOf = new Map([...mappedRead.storyOf, ...surveys.flat().flatMap(([id, , read]) => read.map(({ name }) => [name, id] as const))]);
    // And the edges its imports of them derive, between capabilities (ADR-0991 D1, D2), each path from its own package.
    const baseOf = new Map(surveys.flat().map(([id, , , , base]) => [id, base] as const));
    const derived = storyEdges(surveys.flat().map(([id, survey, read, files, base]) => ({
      id, files, packages: read,
      owners: new Map(survey.files.flatMap((file) => file.capability === undefined ? [] : [[path.posix.normalize(`${base}/${file.path}`), file.capability] as const])),
    })));
    const withEdges = surveys.flat().map(([id, base, read]) => {
      const dependsOn = read.length === 0 ? undefined : [...new Set(read.flatMap(({ deps }) => deps).flatMap((dep) => { const other = storyOf.get(dep); return other === undefined || other === id ? [] : [other]; }))];
      const edges = (derived.get(id) ?? []).map((edge) => ({
        ...edge,
        files: edge.files.map((file) => ({ ...file, from: path.posix.relative(baseOf.get(id)!, file.from), ...(file.to === undefined ? {} : { to: path.posix.relative(baseOf.get(edge.story)!, file.to) }) })),
      }));
      const last = edged.get(id);
      if (last !== undefined && last.base === base && JSON.stringify([last.survey.dependsOn, last.survey.edges]) === JSON.stringify([dependsOn, edges])) return [id, last.survey] as const;
      const survey = { ...base, edges, ...(dependsOn === undefined ? {} : { dependsOn }) };
      edged.set(id, { base, survey });
      return [id, survey] as const;
    });
    for (const full of kept.keys()) if (full.startsWith(checkout + path.sep) && !seen.has(full)) kept.delete(full);
    for (const [full, now] of seen) kept.set(full, now);
    const answer = { ...Object.fromEntries(withEdges), ...Object.fromEntries(mappedRead.surveys) };
    if (keeping !== undefined && keptKeys.get(keeping.file) !== keeping.key) {
      keptKeys.set(keeping.file, keeping.key);
      await keepSurvey(keeping.file, keeping.key, answer);
    }
    return answer;
  }

  return {
    read(folder, tree, imports = []) {
      // One survey of a folder at a time: an ask while one runs takes its answer (ADR-0836 D2).
      const now = running.get(folder) ?? survey(folder, tree, imports).finally(() => running.delete(folder));
      running.set(folder, now);
      return now;
    },
  };
}

const shared = codeSurveyReader();

/** The survey of every story in `tree` whose package the checkout at `folder` holds, and of each mapped story `imports` holds, read through one kept reader. */
export function readCodeSurvey(folder: string, tree: AnnotatedTree, imports?: readonly ImportedFolder[]): Promise<ProjectSurvey> {
  return shared.read(folder, tree, imports);
}

/**
 * A reader whose surveys run on a worker thread started from `workerFile` (this folder's survey-worker, or a
 * bundle of it), so parsing never holds the asking thread's event loop (8.16). The worker starts on the first ask,
 * keeps its reader between asks, and is started again after it dies; close ends it. Given `keptIn`, it keeps its
 * surveys there between starts (8.25), named by the worker file's contents, so a survey kept by another build is not used.
 * Given `startFromFetched`, its reader answers a start's first ask from the main already fetched (8.27).
 */
export function offThreadSurveyReader(workerFile: string | URL, options: { execArgv?: string[]; keptIn?: string; startFromFetched?: boolean } = {}) {
  const keep: SurveyKeep | undefined = options.keptIn === undefined ? undefined
    : { folder: options.keptIn, code: hashOf(readFileSync(typeof workerFile === "string" ? workerFile : fileURLToPath(workerFile), "utf8")) };
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
    const made = new Worker(workerFile, { execArgv: options.execArgv, workerData: { keep, startFromFetched: options.startFromFetched === true } });
    made.on("message", ({ id, survey, error }: { id: number; survey?: ProjectSurvey; error?: string }) => {
      const asked = waiting.get(id);
      waiting.delete(id);
      if (error === undefined) asked?.resolve(survey!);
      else asked?.reject(new Error(error));
      if (waiting.size === 0) made.unref();
    });
    made.on("error", failAll);
    made.on("exit", (code) => { if (worker === made) failAll(new Error(`the survey worker stopped (exit ${code})`)); });
    // An idle worker holds no process open; it is unref'd after its listeners, since attaching one refs it again.
    made.unref();
    worker = made;
    return made;
  };
  return {
    read(folder: string, tree: AnnotatedTree, imports?: readonly ImportedFolder[]): Promise<ProjectSurvey> {
      return new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        const asking = started();
        // While an ask waits, its answer holds the process open.
        asking.ref();
        asking.postMessage({ id, folder, tree, imports });
      });
    },
    async close(): Promise<void> {
      const stopping = worker;
      worker = undefined;
      await stopping?.terminate();
    },
  };
}
