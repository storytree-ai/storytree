/**
 * Capability 8 · Code survey of mapped stories (ADR-0993 D2, D3, D5): each package an import mapped, read
 * from the folder this machine imports it from, as a black box.
 *
 * - A mapped story's files are the JavaScript and TypeScript files Git tracks at its imported checkout's commit
 *   (a folder that is no checkout: every such file in it) under the story's folders, leaving out the skip list's
 *   folders and a folder another package of the same import maps. Each carries its non-blank lines, and the
 *   capability an agent explored that covers it, by a folder above it or by its own path (ADR-0993 D5); the rest
 *   carry none. Nothing parses them, and a black box has no imports to follow until someone explores it.
 * - A mapped story's package dependency, through any field of its package.json, on another mapped story's
 *   package is a road between them. A loop among them is reported on each story round it, and refuses nothing.
 *   Its dependency on a built story's package is never a road: old code never imports new code (ADR-0993 D9).
 * - An import is named by its repository's address, else its folder, as the import keyed it; a mapped story
 *   whose import this machine does not name has no survey.
 * - Surveying again does work in proportion to what changed (ADR-0836): while an imported checkout stays at
 *   its commit each of its stories keeps its files without a walk, and a file is read again only when its
 *   blob (on disk, its size and modified time) changed. Only line counts are kept, never a file's text.
 * - Work done at source and not yet committed there counts (ADR-0993 D1): a changed or new file Git does not
 *   ignore is read from disk over the commit's tree, a deleted one leaves, and only those files are read.
 */
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";

import type { StorySurvey } from "./code-survey.js";
import { importedSource, manifestFrom, SKIPPED, type SurveySource } from "./survey-source.js";

/** A folder this machine imports, as Session management records it: its path, and its repository's address when it has one. */
export type ImportedFolder = { readonly folder: string; readonly repository?: string };

type MappedStory = AnnotatedTree["stories"][number] & { readonly mapped: NonNullable<AnnotatedTree["stories"][number]["mapped"]> };

/** What a story's walk found: its files with their lines, and its package's name and dependencies. */
type Walked = { readonly files: StorySurvey["files"]; readonly name?: string; readonly deps: readonly string[] };

const CODE = /\.[cm]?[jt]sx?$/;
const linesOf = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;

/** Reads mapped stories, keeping line counts and walks so that reading again does only what changed. */
export function mappedSurveyReader(readText: (file: string) => Promise<string>) {
  const counted = new Map<string, { readonly version: string; readonly lines: number }>();
  const manifests = new Map<string, { readonly version: string; readonly manifest: ReturnType<typeof manifestFrom> }>();
  const walked = new Map<string, { readonly key: string; readonly walk: Walked }>();
  const last = new Map<string, StorySurvey>();

  /** A file's lines, read again only when its version changed. */
  async function linesAt(source: SurveySource, full: string): Promise<number | undefined> {
    const found = await source.file(full);
    if (found === undefined) return undefined;
    const kept = counted.get(full);
    if (kept?.version === found.version) return kept.lines;
    const lines = linesOf(await found.read());
    counted.set(full, { version: found.version, lines });
    return lines;
  }

  /** A package.json's name and dependencies, read again only when its version changed. */
  async function manifestAt(source: SurveySource, full: string): Promise<ReturnType<typeof manifestFrom>> {
    const found = await source.file(full);
    if (found === undefined) return undefined;
    const kept = manifests.get(full);
    if (kept?.version === found.version) return kept.manifest;
    const manifest = manifestFrom(await found.read());
    manifests.set(full, { version: found.version, manifest });
    return manifest;
  }

  /** Every code file under `dir` but in `left`, by full path. */
  async function codeUnder(source: SurveySource, dir: string, left: ReadonlySet<string>): Promise<string[]> {
    const found = await Promise.all((await source.entries(dir)).map(async (entry): Promise<string[]> => {
      const full = path.join(dir, entry.name);
      if (entry.directory) return SKIPPED.has(entry.name) || left.has(full) ? [] : codeUnder(source, full, left);
      return entry.file && CODE.test(entry.name) ? [full] : [];
    }));
    return found.flat();
  }

  async function walk(story: MappedStory, source: SurveySource, root: string, left: ReadonlySet<string>): Promise<Walked> {
    const files = (await Promise.all(story.mapped.folders.map(async (folder) => {
      const paths = await codeUnder(source, path.join(root, folder), left);
      return Promise.all(paths.map(async (full) => ({ full, lines: await linesAt(source, full) })));
    }))).flat();
    const manifest = await manifestAt(source, path.join(root, story.mapped.package, "package.json"));
    const listed = new Map(files.flatMap(({ full, lines }) => lines === undefined ? [] : [[path.relative(root, full).split(path.sep).join("/"), lines] as const]));
    return {
      files: [...listed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, lines]) => ({ path: file, lines })),
      ...(manifest === undefined ? {} : { name: manifest.name }),
      deps: manifest?.deps ?? [],
    };
  }

  /**
   * The survey of each mapped story in `stories` whose import is among `imports`, by story id, and the story id
   * of each mapped package's name, for a built story's dependency on it to resolve to.
   */
  async function read(stories: readonly AnnotatedTree["stories"][number][], imports: readonly ImportedFolder[]): Promise<{ readonly surveys: Map<string, StorySurvey>; readonly storyOf: ReadonlyMap<string, string> }> {
    const mapped = stories.filter((story): story is MappedStory => story.mapped !== undefined);
    const byImport = new Map<ImportedFolder, MappedStory[]>();
    for (const story of mapped) {
      const from = imports.find(({ folder, repository }) => repository === story.mapped.from || folder === story.mapped.from);
      if (from !== undefined) byImport.set(from, [...(byImport.get(from) ?? []), story]);
    }
    const found = new Map<string, { readonly story: MappedStory; readonly folder: string; readonly walk: Walked }>();
    await Promise.all([...byImport].map(async ([imported, own]) => {
      const { source, folder: root, commit, local } = await importedSource(imported.folder, readText);
      await Promise.all(own.map(async (story) => {
        // A folder another package of this import maps, inside one of this story's, is that story's to read.
        const left = new Set(own.flatMap((other) => other === story ? [] : other.mapped.folders)
          .filter((folder) => !story.mapped.folders.includes(folder) && story.mapped.folders.some((mine) => inside(folder, mine)))
          .map((folder) => path.join(root, folder)));
        const key = commit === undefined ? undefined : JSON.stringify([root, commit, local ?? "", story.mapped.folders, story.mapped.package, [...left].sort()]);
        const kept = walked.get(story.id);
        const walkedNow = key !== undefined && kept?.key === key ? kept.walk : await walk(story, source, root, left);
        if (key !== undefined) walked.set(story.id, { key, walk: walkedNow });
        found.set(story.id, { story, folder: imported.folder, walk: walkedNow });
      }));
    }));

    const storyOf = new Map([...found].flatMap(([id, { walk: { name } }]) => name === undefined ? [] : [[name, id] as const]));
    const dependsOn = new Map([...found].map(([id, { walk: { deps } }]) => [id, [...new Set(deps.flatMap((dep) => {
      const other = storyOf.get(dep);
      return other === undefined || other === id ? [] : [other];
    }))]] as const));
    const surveys = new Map<string, StorySurvey>();
    for (const [id, { story, folder, walk }] of found) {
      const loop = loopThrough(id, dependsOn);
      // Applied past the walk's keep, so a change of covers is read while the checkout stays at its commit.
      const covering = story.capabilities.flatMap(({ id: capability, covers }) => (covers ?? []).map((cover) => ({ capability, cover })));
      const files = covering.length === 0 ? walk.files : walk.files.map((file) => {
        const owner = covering.find(({ cover }) => cover === "." || file.path === cover || file.path.startsWith(`${cover}/`));
        return owner === undefined ? file : { ...file, capability: owner.capability };
      });
      const survey: StorySurvey = { files, imports: [], tests: [], dependsOn: dependsOn.get(id)!, mapped: { folder, ...(loop === undefined ? {} : { loop }) } };
      const before = last.get(id);
      const kept = before !== undefined && JSON.stringify(before) === JSON.stringify(survey) ? before : survey;
      last.set(id, kept);
      surveys.set(id, kept);
    }
    return { surveys, storyOf };
  }

  return { read };
}

/** Whether `folder` is inside `outer` (both relative to an import, "." its top). */
function inside(folder: string, outer: string): boolean {
  const relative = path.posix.relative(path.posix.normalize(outer), path.posix.normalize(folder));
  return relative !== "" && !relative.startsWith("..") && !path.posix.isAbsolute(relative);
}

/** The shortest loop of roads from `start` back to it, `start` first; undefined when there is none. */
function loopThrough(start: string, roads: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const came = new Map<string, string>();
  const queue = [start];
  for (let at = 0; at < queue.length; at++) {
    const from = queue[at]!;
    for (const to of roads.get(from) ?? []) {
      if (to === start) {
        const loop = [from];
        while (loop[0] !== start) loop.unshift(came.get(loop[0]!)!);
        return loop;
      }
      if (came.has(to)) continue;
      came.set(to, from);
      queue.push(to);
    }
  }
  return undefined;
}
