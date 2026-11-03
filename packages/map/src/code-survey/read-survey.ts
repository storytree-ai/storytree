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
 * - A current-checkout reader given its code's name keeps the checkout's last survey in its Git directory, with
 *   every folder listing and file version the survey consulted: a start that finds each as it was, and the code
 *   and plan the same, answers from it, reading no file but the keep (8.42). A folder with no Git keeps nothing.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { gitText, manifestFrom, noMergedMain, SKIPPED, surveySourceReader, type SurveySource } from "./survey-source.js";
import { mappedCode, mappedSurveyReader, type ImportedFolder, type MappedStory } from "./mapped-survey.js";
import { pytestTestedNumbers } from "./python-tests.js";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { ALSO_OWNED, declaredNumberOf, declaresTitle, dependenciesOf, isCodeFile, isTestFile, packageOf, packagesOf, readsFile, storyEdges, surveyStory, type CoverageMap, type SourceFile, type SurveyPackage } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;


/** The file beside a package's src that holds its coverage map (written by the dev loop's `pnpm survey:coverage`). */
const COVERAGE_MAP = "survey-coverage.json";

export { declaredNumberOf, noMergedMain, packageOf, packagesOf };

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
    const story = storyHolding(tree, file, alsoOwned)?.story;
    if (story === undefined) continue;
    let text: string | undefined;
    try {
      text = readText(file);
    } catch {}
    if (text === undefined) continue;
    const number = declaredNumberOf({ path: file, text }, packagesOf(story, alsoOwned));
    const numbered = number === undefined ? undefined : story.capabilities.find(({ title }) => Number(/^\s*(\d+)\s*·/.exec(title)?.[1]) === number);
    // A source file's header must name the capability its number does here; a test file's numbers carry no title.
    const declared = numbered !== undefined && (isTestFile(file) || declaresTitle(text, numbered.title)) ? numbered : undefined;
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

/** The story of `tree`'s, mapped from a folder of its own or not, whose package holds `file` (repo-relative, forward slashes), with that package's folder. */
function storyHolding(tree: AnnotatedTree, file: string, alsoOwned: AlsoOwned): { story: AnnotatedTree["stories"][number]; folder: string } | undefined {
  for (const story of tree.stories) {
    if (story.mapped !== undefined) continue;
    const name = packagesOf(story, alsoOwned).find((one) => file.startsWith(`packages/${one}/`));
    if (name !== undefined) return { story, folder: `packages/${name}` };
    if (packageOf(story) === "app" && file.startsWith("apps/desktop/")) return { story, folder: "apps/desktop" };
  }
  return undefined;
}

/** Where a file belongs: the path as given, repo-relative, and the story whose package holds it, that package, and its capability when it has one. */
export interface FilePlace {
  readonly file: string;
  readonly path: string;
  readonly story?: { readonly id: string; readonly title: string };
  readonly package?: string;
  readonly capability?: string;
  readonly inferred?: boolean;
}

/**
 * Each of `paths`, absolute or relative to `folder`, placed in the checkout `folder` is in, in order: the story whose
 * package holds it and that package, whether the survey reads the file or not (an .mjs script outside src, a file not
 * yet made), and its capability as {@link capabilitiesOfFiles} places it. A path in no story's package is placed nowhere.
 */
export async function placeFiles(folder: string, paths: readonly string[], tree: AnnotatedTree, options: Parameters<typeof capabilitiesOfFiles>[3] = {}): Promise<FilePlace[]> {
  // Git names the top by its real path, so each path is read by its own.
  const root = await checkoutTop(realOf(folder));
  const relative = paths.map((given) => path.relative(root, realOf(path.resolve(folder, given))).split(path.sep).join("/"));
  const owners = await capabilitiesOfFiles(root, relative, tree, options);
  const alsoOwned = options.alsoOwned ?? ALSO_OWNED;
  return paths.map((file, index) => {
    const at = relative[index]!;
    const holding = storyHolding(tree, at, alsoOwned);
    const owner = owners.get(at);
    return {
      file, path: at,
      ...(holding === undefined ? {} : { story: { id: holding.story.id, title: holding.story.title }, package: holding.folder }),
      ...(owner === undefined ? {} : { capability: owner.capability, inferred: owner.inferred }),
    };
  });
}

/** `file`'s real path, through its nearest folder that exists: a file not yet made has none of its own. */
function realOf(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(realOf(parent), path.basename(file));
  }
}

/** The folder a mapped story imported from `from` is read in: the top of `root`'s checkout when `from` is that top or its remote's address, else the folder of `imports` keyed by it. */
async function importFolder(root: string, from: string, imports: readonly ImportedFolder[]): Promise<string | undefined> {
  const top = await checkoutTop(root);
  if (samePlace(top, from)) return top;
  const remotes = (await gitText(top, ["remote"]).catch(() => "")).split("\n").filter(Boolean);
  const name = remotes.includes("origin") ? "origin" : remotes[0];
  if (name !== undefined && (await gitText(top, ["remote", "get-url", name]).catch(() => undefined)) === from) return top;
  return imports.find(({ folder, repository }) => repository === from || folder === from)?.folder;
}

/**
 * Whether `one` and `other` name the same folder: Git writes Windows paths with forward slashes and long names, where
 * a caller's may be an 8.3 short name or differ in the drive letter's case, so each is resolved to its final path.
 */
function samePlace(one: string, other: string): boolean {
  const final = (folder: string) => {
    const resolved = path.resolve(folder);
    try {
      return realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  };
  const [a, b] = [final(one), final(other)];
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The top of the checkout `folder` is in, or `folder` itself when it is in none. */
async function checkoutTop(folder: string): Promise<string> {
  return gitText(folder, ["rev-parse", "--show-toplevel"]).catch(() => folder);
}

/**
 * The contract numbers the numbered tests in `capability`'s story package carry in `root`'s current
 * checkout, which both front doors skip when they number a new contract, from every package the story owns; none for a
 * capability `tree` lacks. A title prefixed with another story's package carries that package's numbers, not these.
 */
export async function testedNumbers(root: string, tree: AnnotatedTree, capability: string, options: Parameters<typeof storyTests>[3] = {}): Promise<string[]> {
  return (await storyTests(root, tree, capability, options)).numbers;
}

/**
 * {@link testedNumbers}'s numbers, and whether the survey saw `capability`'s story's tests at all: unseen when the
 * checkout holds no package of the story's (a hand-planned story with no code here) and no pytest test carries a number
 * of its, so an empty list is no evidence that a test is missing. A mapped story's tests are read where it was imported
 * from (8.44): `root`'s checkout when that is its import, by the checkout's top or its remote, else the folder of
 * `imports` (this machine's) that is; with neither, it is unseen.
 */
export async function storyTests(root: string, tree: AnnotatedTree, capability: string, {
  alsoOwned = ALSO_OWNED,
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current", alsoOwned }).read(root, plan),
  imports = [],
}: { alsoOwned?: AlsoOwned; survey?(tree: AnnotatedTree): Promise<ProjectSurvey>; imports?: readonly ImportedFolder[] } = {}): Promise<{ numbers: string[]; seen: boolean }> {
  const story = tree.stories.find((one) => one.capabilities.some((part) => part.id === capability));
  if (story === undefined) return { numbers: [], seen: false };
  const own = packagesOf(story, alsoOwned);
  if (story.mapped !== undefined) {
    const mapped = story as MappedStory;
    const from = await importFolder(root, mapped.mapped.from, imports);
    if (from === undefined) return { numbers: [], seen: false };
    const measured = surveyStory(await mappedCode(mapped, from, tree.stories, (file) => readFile(file, "utf8")), story.capabilities, {}, own);
    const numbers = (measured.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || own.includes(title.package)).map((title) => title.number));
    return { numbers, seen: true };
  }
  const surveyed = (await survey({ ...tree, stories: [story] }))[story.id];
  const numbered = (surveyed?.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || own.includes(title.package)).map((title) => title.number));
  // A Python project's pytest tests carry numbers too, for this check alone (ADR-1189).
  const pytest = await pytestTestedNumbers(root, tree, story.id);
  return { numbers: [...numbered, ...pytest], seen: surveyed !== undefined || pytest.length > 0 };
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

/** What a survey read from disk consulted: each folder's listing and each file's version, null for a file that was not there. */
type Witness = { readonly entries: readonly (readonly [string, string])[]; readonly files: readonly (readonly [string, string | null])[] };

/** A survey as kept: the key it was kept for, and for a current checkout what it consulted. */
type KeptSurvey = { readonly key: string; readonly survey: ProjectSurvey; readonly witness?: Witness };

/** The checkout's survey kept in `file`, if the keep holds one; a missing or unreadable keep holds none. */
async function keptSurvey(file: string): Promise<KeptSurvey | undefined> {
  try {
    const kept = JSON.parse(await readFile(file, "utf8")) as Partial<KeptSurvey>;
    return typeof kept.key === "string" && kept.survey !== undefined ? kept as KeptSurvey : undefined;
  } catch {
    return undefined;
  }
}

/** Keep `kept`, replacing the checkout's last; a keep that cannot be written leaves the survey answered all the same. */
async function keepSurvey(file: string, kept: KeptSurvey): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const writing = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(writing, JSON.stringify(kept));
    await rename(writing, file);
  } catch {}
}

type Entries = Awaited<ReturnType<SurveySource["entries"]>>;
const listing = (entries: Entries) => entries.map(({ name, directory, file }) => `${directory ? "d" : file ? "f" : "o"}:${name}`).sort().join("\0");

/** `source`, noting every folder it lists and every file it is asked for, so that what a survey consulted can be checked again by stat alone. */
function witnessing(source: SurveySource): { source: SurveySource; witness(): Witness } {
  const entries = new Map<string, string>();
  const files = new Map<string, string | null>();
  const byPath = (a: readonly [string, unknown], b: readonly [string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    source: {
      ...source,
      async entries(directory) {
        const found = await source.entries(directory);
        entries.set(directory, listing(found));
        return found;
      },
      async file(full) {
        const found = await source.file(full);
        files.set(full, found?.version ?? null);
        return found;
      },
    },
    witness: () => ({ entries: [...entries].sort(byPath), files: [...files].sort(byPath) }),
  };
}

/** Whether every folder and file `witness` names is as it was, read by listing and stat, no file's text. */
async function stillWitnessed(source: SurveySource, witness: Witness): Promise<boolean> {
  const checks = [
    ...witness.entries.map(async ([directory, was]) => listing(await source.entries(directory)) === was),
    ...witness.files.map(async ([full, was]) => ((await source.file(full))?.version ?? null) === was),
  ];
  return (await Promise.all(checks)).every(Boolean);
}

/** The survey's own code: TypeScript, its tests left out. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * The name of the survey's code at `at` (8.43): a hash of every source file, tests left out, in the folder of the file
 * `at` names, a path or a file URL (this module's own by default). In development that is the survey's own folder; in a bundle, the bundle
 * standing for it. None when they cannot be read.
 */
export function surveyCodeName(at: string | URL = import.meta.url): string | undefined {
  try {
    const folder = path.dirname(typeof at === "string" && !at.startsWith("file:") ? at : fileURLToPath(at));
    const names = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && CODE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)).map(({ name }) => name).sort();
    if (names.length === 0) return undefined;
    const hash = createHash("sha256");
    for (const name of names) hash.update(`${name}\0${readFileSync(path.join(folder, name), "utf8")}\0`);
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

export function codeSurveyReader({ readFile: readText = (file: string) => readFile(file, "utf8"), checkout: checkoutScope = "main", keep, codeName, startFromFetched = false, alsoOwned = ALSO_OWNED }: {
  readFile?(file: string): Promise<string>;
  /** The packages stories own beyond the one named after their title (8.30); by default, those package-of.ts declares. */
  alsoOwned?: AlsoOwned;
  /** Main reads fetched origin/main; current reads the caller's worktree. Without origin, main reads the primary folder. */
  checkout?: "main" | "current";
  /** Where surveys of a fetched main are kept between starts (8.25); without it nothing is kept. */
  keep?: SurveyKeep;
  /**
   * The name of the code surveying, asked once when first needed: a current-checkout reader given one keeps the checkout's
   * last survey in its Git directory between starts (8.42), by that name. None keeps nothing.
   */
  codeName?(): string | undefined;
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
      if (!readsFile(entry.name)) return [];
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
      return entry.file && readsFile(entry.name) ? [full] : [];
    }));
    return found.flat();
  }

  /**
 * The build steps and cleanups storytree.check.json's `placement.plumbing` declares, keyed by the importing file's
 * repository path and the package folder it reaches (`packages/<to>`); empty when there is none or it does not parse.
 */
async function declaredPlumbing(source: SurveySource, checkout: string): Promise<ReadonlyMap<string, "build step" | "cleanup">> {
  const found = await source.file(path.join(checkout, "storytree.check.json"));
  if (found === undefined) return new Map();
  let declared: unknown;
  try {
    declared = JSON.parse(await found.read());
  } catch {
    return new Map();
  }
  const calls = (declared as { placement?: { plumbing?: unknown } } | null)?.placement?.plumbing;
  if (!Array.isArray(calls)) return new Map();
  return new Map(calls.flatMap((call: { from?: unknown; to?: unknown; kind?: unknown }) =>
    typeof call?.from === "string" && typeof call.to === "string" && (call.kind === "build step" || call.kind === "cleanup")
      ? [[`${path.posix.normalize(call.from)} packages/${call.to}`, call.kind] as const] : []));
}

/** The checkout's last kept survey by its file, and the key it was kept for: written again only when that changes. */
  const keptKeys = new Map<string, string>();
  /** Each current checkout's last survey by its keep's file, with what it consulted: the disk's keep is read only before there is one. */
  const keptCurrent = new Map<string, KeptSurvey>();
  const gitDirectories = new Map<string, Promise<string | undefined>>();
  let code: { readonly name: string | undefined } | undefined;

  /** Where the current checkout at `checkout` keeps its survey of `tree`, and the key it keeps it for; none without Git or a code name. */
  async function currentKeep(checkout: string, tree: AnnotatedTree): Promise<{ file: string; key: string } | undefined> {
    if (checkoutScope !== "current" || codeName === undefined || tree.stories.some((story) => story.mapped !== undefined)) return undefined;
    code ??= { name: codeName() };
    if (code.name === undefined) return undefined;
    if (!gitDirectories.has(checkout)) gitDirectories.set(checkout, gitText(checkout, ["rev-parse", "--path-format=absolute", "--git-dir"]).catch(() => undefined));
    const gitDirectory = await gitDirectories.get(checkout)!;
    if (gitDirectory === undefined) return undefined;
    return {
      file: path.join(gitDirectory, "storytree", "current-survey.json"),
      key: hashOf(JSON.stringify([code.name, alsoOwned, tree.stories.map(({ id, title, capabilities }) => [id, title, capabilities.map((part) => [part.id, part.title])])])),
    };
  }

  async function survey(folder: string, tree: AnnotatedTree, imports: readonly ImportedFolder[]): Promise<ProjectSurvey> {
    const opened = await sourceAt(folder);
    const checkout = opened.root;
    const current = await currentKeep(checkout, tree);
    if (current !== undefined) {
      const last = keptCurrent.get(current.file) ?? await keptSurvey(current.file);
      if (last?.key === current.key && last.witness !== undefined && await stillWitnessed(opened, last.witness)) {
        keptCurrent.set(current.file, last);
        return last.survey;
      }
    }
    const recording = current === undefined ? undefined : witnessing(opened);
    const source = recording?.source ?? opened;
    const keeping = keep === undefined || source.commit === undefined || tree.stories.some((story) => story.mapped !== undefined) ? undefined : {
      file: path.join(keep.folder, `${hashOf(checkout).slice(0, 16)}.json`),
      key: hashOf(JSON.stringify([keep.code, source.commit, tree.stories.map(({ id, title, capabilities }) => [id, title, capabilities.map((part) => [part.id, part.title])])])),
    };
    if (keeping !== undefined) {
      const found = keptKeys.get(keeping.file) === keeping.key || !keptKeys.has(keeping.file) ? await keptSurvey(keeping.file) : undefined;
      if (found?.key === keeping.key) {
        keptKeys.set(keeping.file, keeping.key);
        return found.survey;
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
      const paths = new Set([...loaded.keys(), ...outside.keys()].filter(isCodeFile));
      const queue = [...paths].filter(isTestFile);
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
    // Build steps and cleanups no code shows, as the checkout declares them (8.33): matched by the importing file's
    // repository path and the package it reaches, since story ids need not be package names.
    const plumbingOf = await declaredPlumbing(source, checkout);
    const derived = storyEdges(surveys.flat().map(([id, survey, read, files, base]) => ({
      id, files, packages: read,
      owners: new Map(survey.files.flatMap((file) => file.capability === undefined ? [] : [[path.posix.normalize(`${base}/${file.path}`), file.capability] as const])),
    })));
    const withEdges = surveys.flat().map(([id, base, read]) => {
      const dependsOn = read.length === 0 ? undefined : [...new Set(read.flatMap(({ deps }) => deps).flatMap((dep) => { const other = storyOf.get(dep); return other === undefined || other === id ? [] : [other]; }))];
      const edges = (derived.get(id) ?? []).map((edge) => ({
        ...edge,
        files: edge.files.map((file) => {
          const plumbing = plumbingOf.get(`${file.from} ${baseOf.get(edge.story)}`);
          return { ...file, from: path.posix.relative(baseOf.get(id)!, file.from), ...(file.to === undefined ? {} : { to: path.posix.relative(baseOf.get(edge.story)!, file.to) }), ...(plumbing === undefined ? {} : { plumbing }) };
        }),
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
      await keepSurvey(keeping.file, { key: keeping.key, survey: answer });
    }
    if (current !== undefined) {
      const now: KeptSurvey = { key: current.key, survey: answer, witness: recording!.witness() };
      const last = keptCurrent.get(current.file);
      keptCurrent.set(current.file, now);
      if (last?.key !== now.key || JSON.stringify(last.witness) !== JSON.stringify(now.witness)) await keepSurvey(current.file, now);
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
 * surveys there between starts (8.25), named by the survey's code, every source file beside the worker (8.43), so a survey
 * kept by other survey code is not used; with no name for that code it keeps nothing.
 * Given `startFromFetched`, its reader answers a start's first ask from the main already fetched (8.27).
 */
export function offThreadSurveyReader(workerFile: string | URL, options: { execArgv?: string[]; keptIn?: string; startFromFetched?: boolean } = {}) {
  const codeName = options.keptIn === undefined ? undefined : surveyCodeName(workerFile);
  const keep: SurveyKeep | undefined = options.keptIn === undefined || codeName === undefined ? undefined : { folder: options.keptIn, code: codeName };
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
