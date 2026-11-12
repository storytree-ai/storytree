/**
 * Capability 8 · Code survey of mapped stories (ADR-0993 D2, D3, D5): each package an import mapped, read
 * from the folder this machine imports it from, as a black box.
 *
 * - A mapped story's files are the files of a language the survey reads (JavaScript, TypeScript, Python) Git tracks at its imported checkout's commit
 *   (a folder that is no checkout: every such file in it) under the story's folders, leaving out the skip list's
 *   folders and a folder another package of the same import maps. Each carries its non-blank lines, and the
 *   capability an agent explored that covers it, by a folder above it or by its own path (ADR-0993 D5); the rest
 *   carry none. A black box has no imports to follow until someone explores it: only once two capabilities cover its
 *   files are their imports read, statically, with no code run, and an import from a file of one of them of a file of
 *   another is an edge between them, so its island draws the road (8.58); imports of anything else are none.
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

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { readersReady, readsFile, storyEdges, type SourceFile } from "./code-survey.js";
import { importedSource, manifestFrom, SKIPPED, type SurveySource } from "./survey-source.js";

/** A folder this machine imports, as Session management records it: its path, and its repository's address when it has one. */
export type ImportedFolder = { readonly folder: string; readonly repository?: string };

export type MappedStory = AnnotatedTree["stories"][number] & { readonly mapped: NonNullable<AnnotatedTree["stories"][number]["mapped"]> };

/** What a story's walk found: its files with their lines and versions, and its package's name and dependencies. */
type Walked = { readonly files: StorySurvey["files"]; readonly versions: readonly string[]; readonly name?: string; readonly deps: readonly string[] };

const linesOf = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;

/** Reads mapped stories, keeping line counts and walks so that reading again does only what changed. */
export function mappedSurveyReader(readText: (file: string) => Promise<string>) {
  const counted = new Map<string, { readonly version: string; readonly lines: number }>();
  const manifests = new Map<string, { readonly version: string; readonly manifest: ReturnType<typeof manifestFrom> }>();
  const walked = new Map<string, { readonly key: string; readonly walk: Walked }>();
  const edged = new Map<string, { readonly key: string; readonly edges: NonNullable<StorySurvey["edges"]> }>();
  const last = new Map<string, StorySurvey>();

  /** A file's lines and version, its lines read again only when its version changed. */
  async function linesAt(source: SurveySource, full: string): Promise<{ readonly lines: number; readonly version: string } | undefined> {
    const found = await source.file(full);
    if (found === undefined) return undefined;
    const kept = counted.get(full);
    if (kept?.version === found.version) return kept;
    const lines = linesOf(await found.read());
    counted.set(full, { version: found.version, lines });
    return { lines, version: found.version };
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

  async function walk(story: MappedStory, source: SurveySource, root: string, left: ReadonlySet<string>): Promise<Walked> {
    const files = (await Promise.all(story.mapped.folders.map(async (folder) => {
      const paths = await codeUnder(source, path.join(root, folder), left);
      return Promise.all(paths.map(async (full) => ({ full, read: await linesAt(source, full) })));
    }))).flat();
    const manifest = await manifestAt(source, path.join(root, story.mapped.package, "package.json"));
    const listed = [...new Map(files.flatMap(({ full, read }) => read === undefined ? [] : [[path.relative(root, full).split(path.sep).join("/"), read] as const]))]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      files: listed.map(([file, { lines }]) => ({ path: file, lines })),
      versions: listed.map(([, { version }]) => version),
      ...(manifest === undefined ? {} : { name: manifest.name }),
      deps: manifest?.deps ?? [],
    };
  }

  /**
   * The edges between `story`'s capabilities its imports make (8.58), read from `root` in `source` only when two of its
   * capabilities cover its files, and again only when a file or the covers changed.
   */
  async function edgesOf(story: MappedStory, source: SurveySource, root: string, walk: Walked, files: StorySurvey["files"]): Promise<NonNullable<StorySurvey["edges"]>> {
    const owners = new Map(files.flatMap((file) => file.capability === undefined ? [] : [[file.path, file.capability] as const]));
    if (new Set(owners.values()).size < 2) return [];
    const key = JSON.stringify([walk.files.map((file) => file.path), walk.versions, [...owners]]);
    const kept = edged.get(story.id);
    if (kept?.key === key) return kept.edges;
    const code = (await Promise.all(walk.files.map(async ({ path: file }): Promise<SourceFile | undefined> => {
      const found = await source.file(path.join(root, file));
      return found === undefined ? undefined : { path: file, text: await found.read() };
    }))).filter((file): file is SourceFile => file !== undefined);
    await readersReady(code.map((file) => file.path));
    // Its package's folder roots its absolute imports, as a built package's does: its src/, then the folder itself.
    const packageRoot = story.mapped.package === "." ? "" : `${path.posix.normalize(story.mapped.package)}/`;
    const edges = storyEdges([{ id: story.id, files: code, packages: [{ root: packageRoot, name: walk.name ?? story.mapped.package, exports: {} }], owners }]).get(story.id) ?? [];
    edged.set(story.id, { key, edges });
    return edges;
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
    const found = new Map<string, { readonly story: MappedStory; readonly folder: string; readonly source: SurveySource; readonly root: string; readonly walk: Walked }>();
    await Promise.all([...byImport].map(async ([imported, own]) => {
      const { source, folder: root, commit, local } = await importedSource(imported.folder, readText);
      await Promise.all(own.map(async (story) => {
        // A folder another package of this import maps, inside one of this story's, is that story's to read.
        const left = leftOut(story, own, root);
        const key = commit === undefined ? undefined : JSON.stringify([root, commit, local ?? "", story.mapped.folders, story.mapped.package, [...left].sort()]);
        const kept = walked.get(story.id);
        const walkedNow = key !== undefined && kept?.key === key ? kept.walk : await walk(story, source, root, left);
        if (key !== undefined) walked.set(story.id, { key, walk: walkedNow });
        found.set(story.id, { story, folder: imported.folder, source, root, walk: walkedNow });
      }));
    }));

    const storyOf = new Map([...found].flatMap(([id, { walk: { name } }]) => name === undefined ? [] : [[name, id] as const]));
    const dependsOn = new Map([...found].map(([id, { walk: { deps } }]) => [id, [...new Set(deps.flatMap((dep) => {
      const other = storyOf.get(dep);
      return other === undefined || other === id ? [] : [other];
    }))]] as const));
    const surveys = new Map<string, StorySurvey>();
    for (const [id, { story, folder, source, root, walk }] of found) {
      const loop = loopThrough(id, dependsOn);
      // Applied past the walk's keep, so a change of covers is read while the checkout stays at its commit.
      const covering = story.capabilities.flatMap(({ id: capability, covers }) => (covers ?? []).map((cover) => ({ capability, cover })));
      const files = covering.length === 0 ? walk.files : walk.files.map((file) => {
        const owner = covering.find(({ cover }) => cover === "." || file.path === cover || file.path.startsWith(`${cover}/`));
        return owner === undefined ? file : { ...file, capability: owner.capability };
      });
      const edges = await edgesOf(story, source, root, walk, files);
      const survey: StorySurvey = { files, imports: [], tests: [], ...(edges.length === 0 ? {} : { edges }), dependsOn: dependsOn.get(id)!, mapped: { folder, ...(loop === undefined ? {} : { loop }) } };
      const before = last.get(id);
      const kept = before !== undefined && JSON.stringify(before) === JSON.stringify(survey) ? before : survey;
      last.set(id, kept);
      surveys.set(id, kept);
    }
    return { surveys, storyOf };
  }

  return { read };
}

/** Every code file under `dir` but in `left`, by full path. */
async function codeUnder(source: SurveySource, dir: string, left: ReadonlySet<string>): Promise<string[]> {
  const found = await Promise.all((await source.entries(dir)).map(async (entry): Promise<string[]> => {
    const full = path.join(dir, entry.name);
    if (entry.directory) return SKIPPED.has(entry.name) || left.has(full) ? [] : codeUnder(source, full, left);
    return entry.file && readsFile(entry.name) ? [full] : [];
  }));
  return found.flat();
}

/** Of an imported story, what reading its code needs: where it was imported from and its folders. */
type Imported = Pick<MappedStory, "mapped">;

/** The folders, by full path under `root`, that another of `own` (the stories of one import) maps inside one of `story`'s: that story's to read. */
function leftOut(story: Imported, own: readonly Imported[], root: string): Set<string> {
  return new Set(own.flatMap((other) => other === story ? [] : other.mapped.folders)
    .filter((folder) => !story.mapped.folders.includes(folder) && story.mapped.folders.some((mine) => inside(folder, mine)))
    .map((folder) => path.join(root, folder)));
}

/**
 * The code files of mapped `story`, with their text, read from `folder`, where its import is (its checkout's commit
 * with the work done there since, else the folder on disk), each by its path from there; `stories` are the plan's
 * stories, whose folders another package of the same import maps are left out. What a mapped story's numbered tests
 * are read from, so a landing sees them (ADR-1213 D1).
 */
export async function mappedCode(story: Imported, folder: string, stories: readonly { readonly mapped?: Imported["mapped"] | undefined }[], readText: (file: string) => Promise<string>): Promise<SourceFile[]> {
  const { source, folder: root } = await importedSource(folder, readText);
  const own = stories.filter((other): other is Imported => other.mapped?.from === story.mapped.from);
  const left = leftOut(story, own.includes(story) ? own : [...own, story], root);
  const paths = [...new Set((await Promise.all(story.mapped.folders.map((mine) => codeUnder(source, path.join(root, mine), left)))).flat())];
  const files = await Promise.all(paths.map(async (full): Promise<SourceFile | undefined> => {
    const found = await source.file(full);
    return found === undefined ? undefined : { path: path.relative(root, full).split(path.sep).join("/"), text: await found.read() };
  }));
  return files.filter((file): file is SourceFile => file !== undefined).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
