// Capability 8 · Code survey
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { gitText, importedSource, manifestFrom, noMergedMain, SKIPPED, surveySourceReader, type SurveySource } from "./survey-source.js";
import { mappedCode, mappedSurveyReader, type ImportedFolder, type MappedStory } from "./mapped-survey.js";
import { usePythonParser } from "./python-reader.js";
import { pyprojectFrom } from "./pyproject.js";
import { parsePythonNow, pythonLanguage } from "./tree-sitter.js";
import { pytestTestedNumbers } from "./python-tests.js";
import { folderLanguages } from "./folder-languages.js";
import { drawImportedStory, manifestsOf, type Drawing } from "./drawing.js";
import { nestedParts } from "./nested-parts.js";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { ALSO_OWNED, declaredNumberOf, declaresTitle, dependenciesOf, isCodeFile, isTestFile, packageOf, packagesOf, readersReady, readsFile, storyEdges, surveyStory, type CoverageMap, type SourceFile, type SurveyPackage } from "./code-survey.js";

usePythonParser({ load: pythonLanguage, parse: parsePythonNow });

export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const COVERAGE_MAP = "survey-coverage.json";

export { declaredNumberOf, folderLanguages, noMergedMain, packageOf, packagesOf };
export { languageList, SURVEYED_LANGUAGES } from "./languages.js";
export type { SharedStore, StoreTable } from "./stores.js";

type AlsoOwned = Readonly<Record<string, readonly string[]>>;

export interface FileOwner {
  readonly capability: string;
  readonly inferred: boolean;
}

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
    if (text === undefined || onlyReExports(file, text)) continue;
    const number = declaredNumberOf({ path: file, text }, packagesOf(story, alsoOwned));
    const numbered = number === undefined ? undefined : story.capabilities.find(({ title }) => Number(/^\s*(\d+)\s*·/.exec(title)?.[1]) === number);
    const declared = numbered !== undefined && (isTestFile(file) || declaresTitle({ path: file, text }, numbered.title)) ? numbered : undefined;
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

const RE_EXPORT = /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])[^"']*\1\s*;?/;

function onlyReExports(file: string, text: string): boolean {
  if (!/\.[cm]?[jt]sx?$/.test(file) || isTestFile(file)) return false;
  let rest = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  let found = false;
  for (let match = RE_EXPORT.exec(rest); match !== null; match = RE_EXPORT.exec(rest)) {
    rest = rest.slice(match[0].length);
    found = true;
  }
  return found && rest.trim() === "";
}

function storyHolding(tree: AnnotatedTree, file: string, alsoOwned: AlsoOwned): { story: AnnotatedTree["stories"][number]; folder: string } | undefined {
  for (const story of tree.stories) {
    if (story.mapped !== undefined) continue;
    const name = packagesOf(story, alsoOwned).find((one) => file.startsWith(`packages/${one}/`));
    if (name !== undefined) return { story, folder: `packages/${name}` };
    if (packageOf(story) === "app" && file.startsWith("apps/desktop/")) return { story, folder: "apps/desktop" };
  }
  return undefined;
}

export interface FilePlace {
  readonly file: string;
  readonly path: string;
  readonly story?: { readonly id: string; readonly title: string };
  readonly package?: string;
  readonly capability?: string;
  readonly inferred?: boolean;
}

export async function placeFiles(folder: string, paths: readonly string[], tree: AnnotatedTree, options: Parameters<typeof capabilitiesOfFiles>[3] = {}): Promise<FilePlace[]> {
  const root = realOf(await checkoutTop(realOf(folder)));
  const tops = new Map<string, Promise<string>>();
  const topOf = (at: string): Promise<string> => {
    if (!tops.has(at)) tops.set(at, gitText(at, ["rev-parse", "--show-toplevel"]).then(realOf, () => root));
    return tops.get(at)!;
  };
  const located = await Promise.all(paths.map(async (given) => {
    const real = realOf(path.resolve(folder, given));
    const top = await topOf(existingFolder(path.dirname(real)));
    return { top, at: path.relative(top, real).split(path.sep).join("/") };
  }));
  const alsoOwned = options.alsoOwned ?? ALSO_OWNED;
  const owners = new Map<string, Map<string, FileOwner>>();
  for (const top of new Set(located.map(({ top }) => top))) {
    owners.set(top, await capabilitiesOfFiles(top, located.filter((one) => one.top === top).map(({ at }) => at), tree, options));
  }
  return paths.map((file, index) => {
    const { top, at } = located[index]!;
    const holding = storyHolding(tree, at, alsoOwned);
    const owner = owners.get(top)!.get(at);
    return {
      file, path: at,
      ...(holding === undefined ? {} : { story: { id: holding.story.id, title: holding.story.title }, package: holding.folder }),
      ...(owner === undefined ? {} : { capability: owner.capability, inferred: owner.inferred }),
    };
  });
}

function existingFolder(folder: string): string {
  let at = folder;
  while (!existsSync(at)) at = path.dirname(at);
  return at;
}

function realOf(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(realOf(parent), path.basename(file));
  }
}

async function importFolder(root: string, from: string, imports: readonly ImportedFolder[]): Promise<string | undefined> {
  const top = await checkoutTop(root);
  if (samePlace(top, from)) return top;
  const remotes = (await gitText(top, ["remote"]).catch(() => "")).split("\n").filter(Boolean);
  const name = remotes.includes("origin") ? "origin" : remotes[0];
  if (name !== undefined && (await gitText(top, ["remote", "get-url", name]).catch(() => undefined)) === from) return top;
  return imports.find(({ folder, repository }) => repository === from || folder === from)?.folder;
}

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

async function checkoutTop(folder: string): Promise<string> {
  return gitText(folder, ["rev-parse", "--show-toplevel"]).catch(() => folder);
}

export async function testedNumbers(root: string, tree: AnnotatedTree, capability: string, options: Parameters<typeof storyTests>[3] = {}): Promise<string[]> {
  return (await storyTests(root, tree, capability, options)).numbers;
}

export async function drawImport(story: Pick<MappedStory, "mapped">, folder: string, stories: Parameters<typeof mappedCode>[2], readText: (file: string) => Promise<string> = (file) => readFile(file, "utf8")): Promise<Drawing> {
  const code = await mappedCode(story, folder, stories, readText);
  await readersReady(code.map((file) => file.path));
  const manifests = await manifestsOf(code, (file) => readText(path.join(folder, file)).catch(() => undefined));
  return drawImportedStory({ folder: story.mapped.package, files: [...code, ...manifests] });
}

export async function drawsItself(root: string, story: Pick<MappedStory, "mapped">, stories: Parameters<typeof mappedCode>[2], imports: readonly ImportedFolder[] = []): Promise<boolean> {
  const from = await importFolder(root, story.mapped.from, imports);
  if (from === undefined) return false;
  return (await drawImport(story, from, stories)).capabilities.length > 0;
}

export type { Drawing, DrawnCapability } from "./drawing.js";

export async function storyTests(root: string, tree: AnnotatedTree, capability: string, {
  alsoOwned = ALSO_OWNED,
  survey = (plan: AnnotatedTree) => codeSurveyReader({ checkout: "current", alsoOwned }).read(root, plan),
  imports = [],
}: { alsoOwned?: AlsoOwned; survey?(tree: AnnotatedTree): Promise<ProjectSurvey>; imports?: readonly ImportedFolder[] } = {}): Promise<{ numbers: string[]; seen: boolean; unreadable?: string[] }> {
  const story = tree.stories.find((one) => one.capabilities.some((part) => part.id === capability));
  if (story === undefined) return { numbers: [], seen: false };
  const own = packagesOf(story, alsoOwned);
  if (story.mapped !== undefined) {
    const mapped = story as MappedStory;
    const from = await importFolder(root, mapped.mapped.from, imports);
    if (from === undefined) return { numbers: [], seen: false };
    const code = await mappedCode(mapped, from, tree.stories, (file) => readFile(file, "utf8"));
    await readersReady(code.map((file) => file.path));
    const measured = surveyStory(code, story.capabilities, {}, own);
    const numbers = (measured.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || own.includes(title.package)).map((title) => title.number));
    return { numbers, seen: true };
  }
  const surveyed = (await survey({ ...tree, stories: [story] }))[story.id];
  const numbered = (surveyed?.tests ?? []).flatMap((test) => test.titles.filter((title) => title.package === undefined || own.includes(title.package)).map((title) => title.number));
  const pytest = await pytestTestedNumbers(root, tree, story.id, surveyed === undefined ? [] : own.map((name) => `packages/${name}`));
  const seen = surveyed !== undefined || pytest.length > 0;
  const languages = seen ? undefined : await folderLanguages(root).catch(() => undefined);
  const unreadable = languages !== undefined && languages.read.length === 0 && languages.unread.length > 0 ? languages.unread : undefined;
  return { numbers: [...numbered, ...pytest], seen, ...(unreadable === undefined ? {} : { unreadable }) };
}

export function untestedContracts(tree: AnnotatedTree, capability: string, tested: readonly string[]): string[] {
  const proven = new Set(tested);
  const contracts = tree.stories.flatMap((story) => story.capabilities).find((part) => part.id === capability)?.contracts ?? [];
  return contracts.filter((contract) => {
    const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
    const ran = contract.provedBy !== undefined && contract.health?.verified.state !== undefined && contract.health.verified.state !== "not-checked";
    return number !== undefined && !proven.has(number) && !ran;
  }).map((contract) => contract.title);
}

type Kept = { readonly version: string; readonly file: SourceFile };

export interface CodeSurveyReader {
  read(folder: string, tree: AnnotatedTree, imports?: readonly ImportedFolder[]): Promise<ProjectSurvey>;
}

export type { ImportedFolder };

function coverageFrom(text: string): CoverageMap {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as CoverageMap) : {};
  } catch {
    return {};
  }
}

export interface SurveyKeep {
  readonly folder: string;
  readonly code: string;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

type Witness = { readonly entries: readonly (readonly [string, string])[]; readonly files: readonly (readonly [string, string | null])[] };

type KeptSurvey = { readonly key: string; readonly survey: ProjectSurvey; readonly witness?: Witness };

async function keptSurvey(file: string): Promise<KeptSurvey | undefined> {
  try {
    const kept = JSON.parse(await readFile(file, "utf8")) as Partial<KeptSurvey>;
    return typeof kept.key === "string" && kept.survey !== undefined ? kept as KeptSurvey : undefined;
  } catch {
    return undefined;
  }
}

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

async function stillWitnessed(source: SurveySource, witness: Witness): Promise<boolean> {
  const checks = [
    ...witness.entries.map(async ([directory, was]) => listing(await source.entries(directory)) === was),
    ...witness.files.map(async ([full, was]) => ((await source.file(full))?.version ?? null) === was),
  ];
  return (await Promise.all(checks)).every(Boolean);
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

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
  alsoOwned?: AlsoOwned;
  checkout?: "main" | "current";
  keep?: SurveyKeep;
  codeName?(): string | undefined;
  startFromFetched?: boolean;
} = {}): CodeSurveyReader {
  const sourceAt = surveySourceReader(checkoutScope, readText, startFromFetched);
  const kept = new Map<string, Kept>();
  const positioned = new WeakMap<SourceFile, SourceFile>();
  const surveyed = new Map<string, { readonly files: readonly SourceFile[]; readonly capabilities: string; readonly packages: string; readonly survey: StorySurvey }>();
  const running = new Map<string, Promise<ProjectSurvey>>();
  const edged = new Map<string, { readonly base: StorySurvey; readonly survey: StorySurvey }>();
  const mappedReader = mappedSurveyReader(readText);

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

  async function codeBeside(source: SurveySource, root: string, dir: string): Promise<string[]> {
    const entries = await source.entries(dir);
    const found = await Promise.all(entries.map(async (entry): Promise<string[]> => {
      const full = path.join(dir, entry.name);
      if (entry.directory) return SKIPPED.has(entry.name) || (dir === root && entry.name === "src") ? [] : codeBeside(source, root, full);
      return entry.file && readsFile(entry.name) ? [full] : [];
    }));
    return found.flat();
  }

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

  const keptKeys = new Map<string, string>();
  const keptCurrent = new Map<string, KeptSurvey>();
  const gitDirectories = new Map<string, Promise<string | undefined>>();
  let code: { readonly name: string | undefined } | undefined;

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
    mapped.catch(() => {});
    const surveys = await Promise.all(tree.stories.filter((story) => story.mapped === undefined).map(async (story) => {
      const owned = packagesOf(story, alsoOwned);
      const storyPackage = owned[0]!;
      const root = path.join(checkout, "packages", storyPackage);
      const roots = owned.map((name) => path.join(checkout, "packages", name));
      const sources = (await Promise.all(roots.map((dir) => filesUnder(source, root, path.join(dir, "src"), seen)))).flat();
      if (storyPackage === "app") sources.push(...await filesUnder(source, root, path.join(checkout, "apps", "desktop", "src"), seen));
      if (sources.length === 0) return [];
      const beside = (await Promise.all(roots.map((dir) => codeBeside(source, dir, dir)))).flat();
      const manifestPaths = [...roots.map((dir) => path.join(dir, "package.json")), ...(storyPackage === "app" ? [path.join(checkout, "apps", "desktop", "package.json")] : [])];
      const manifests = await Promise.all(manifestPaths.map((file) => fileAt(source, root, file, seen)));
      const pyprojects = await Promise.all(roots.map((dir) => fileAt(source, root, path.join(dir, "pyproject.toml"), seen)));
      const maps = await Promise.all(roots.map((dir) => fileAt(source, root, path.join(dir, COVERAGE_MAP), seen)));
      const capabilities = JSON.stringify(story.capabilities.map(({ id, title }) => [id, title]));
      const last = surveyed.get(story.id);
      const read = manifests.flatMap((file) => {
        const manifest = file === undefined ? undefined : manifestFrom(file.text);
        return manifest === undefined ? [] : [{ ...manifest, root: path.posix.dirname(path.posix.normalize(`packages/${storyPackage}/${file!.path}`)) + "/" }];
      }).concat(pyprojects.flatMap((file) => {
        const project = file === undefined ? undefined : pyprojectFrom(file.text);
        return project === undefined ? [] : [{ ...project, imports: {}, parts: {}, root: path.posix.dirname(path.posix.normalize(`packages/${storyPackage}/${file!.path}`)) + "/" }];
      }));
      const base = `packages/${storyPackage}`;
      const inCheckout = (file: string) => path.posix.normalize(`${base}/${file}`);
      const inPackage = (file: string) => path.posix.relative(base, file);
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
      await readersReady(paths);
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
      const coverage = Object.fromEntries(maps.flatMap((map, at) => map === undefined ? [] : Object.entries(coverageFrom(map.text)).map(([file, counts]) => [path.posix.normalize(`packages/${owned[at]}/${file}`), counts] as const)));
      const measured = surveyStory(sources.map(inRepository), story.capabilities, coverage, owned, read);
      const relativeImport = ({ from, to }: { from: string; to: string }) => ({ from: inPackage(from), to: inPackage(to) });
      const fresh: StorySurvey = {
        files: measured.files.map((file) => ({ ...file, path: inPackage(file.path) })),
        imports: measured.imports.map(relativeImport),
        tests: (measured.tests ?? []).map((file) => ({ ...file, path: inPackage(file.path), imports: file.imports.map(relativeImport) })),
      };
      const parts = nestedParts(fresh, read.length === 0 ? [""] : read.map((pkg) => inPackage(pkg.root)));
      if (parts !== undefined) Object.assign(fresh, { parts });
      surveyed.set(story.id, { files, capabilities, packages, survey: fresh });
      return [[story.id, fresh, read, sources.map(inRepository), base] as const];
    }));
    const mappedRead = await mapped;
    const storyOf = new Map([...mappedRead.storyOf, ...surveys.flat().flatMap(([id, , read]) => read.map(({ name }) => [name, id] as const))]);
    const baseOf = new Map(surveys.flat().map(([id, , , , base]) => [id, base] as const));
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
      const now = running.get(folder) ?? survey(folder, tree, imports).finally(() => running.delete(folder));
      running.set(folder, now);
      return now;
    },
  };
}

const shared = codeSurveyReader();

export function readCodeSurvey(folder: string, tree: AnnotatedTree, imports?: readonly ImportedFolder[]): Promise<ProjectSurvey> {
  return shared.read(folder, tree, imports);
}

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
