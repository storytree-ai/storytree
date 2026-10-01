/**
 * Capability 8 · Code survey, read from disk: each story's package in a project's checkout, surveyed.
 * Node only (the app's main process reads it; the page cannot reach the disk).
 *
 * - The checkout is the main one of the folder's repository, so a session's worktree never stands in
 *   for the project's code.
 * - A story's package is the one named after its title ("The agent link" is packages/agent-link),
 *   but for a story whose package was named otherwise; a story with no such package has no code yet.
 * - A story's package.json says which other stories' packages it depends on, through any dependency
 *   field: the code's edges between stories, which place the islands in rows (ADR-0840 D2).
 * - A package's coverage map (survey-coverage.json beside its src, ADR-0838 D3) is read with its files,
 *   and again only when it changed.
 * - Surveying again reads only what changed (ADR-0836 D2): a file whose size and modified time are as
 *   last read is not read again, a story none of whose files changed keeps its survey, the checkout is
 *   found once per folder without blocking, and one survey of a folder runs at a time.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf, surveyStory, type CoverageMap, type SourceFile, type StorySurvey } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

/** The dependency fields of a package.json, in the order their names are listed. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** A package.json's name and the packages it depends on through any field; undefined when it cannot be read. */
function manifestFrom(text: string): { name: string; deps: string[] } | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.name !== "string") return undefined;
    const deps = DEPENDENCY_FIELDS.flatMap((field) => {
      const named = parsed[field];
      return typeof named === "object" && named !== null ? Object.keys(named) : [];
    });
    return { name: parsed.name, deps: [...new Set(deps)] };
  } catch {
    return undefined;
  }
}

/** The file beside a package's src that holds its coverage map (written by the dev loop's `pnpm survey:coverage`). */
const COVERAGE_MAP = "survey-coverage.json";

export { packageOf };

/** The main checkout of the repository `folder` is in, or `folder` itself when git cannot say. */
async function mainCheckout(folder: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, encoding: "utf8", timeout: 5_000, windowsHide: true });
    const common = stdout.trim();
    return path.basename(common) === ".git" ? path.dirname(common) : folder;
  } catch {
    return folder;
  }
}

/** A file as last read: kept while its size and modified time are unchanged. */
type Kept = { readonly size: number; readonly mtimeMs: number; readonly file: SourceFile };

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

export function codeSurveyReader({ readFile: readText = (file: string) => readFile(file, "utf8") }: { readFile?(file: string): Promise<string> } = {}): CodeSurveyReader {
  const checkouts = new Map<string, Promise<string>>();
  const kept = new Map<string, Kept>();
  const surveyed = new Map<string, { readonly files: readonly SourceFile[]; readonly capabilities: string; readonly survey: StorySurvey }>();
  const running = new Map<string, Promise<ProjectSurvey>>();
  const edged = new Map<string, { readonly base: StorySurvey; readonly survey: StorySurvey }>();

  /** A file at `full`, its path from `root` with forward slashes, read again only if it changed; undefined when there is none. */
  async function fileAt(root: string, full: string, seen: Map<string, Kept>): Promise<SourceFile | undefined> {
    const found = await stat(full).catch(() => undefined);
    if (found === undefined || !found.isFile()) return undefined;
    const { size, mtimeMs } = found;
    const last = kept.get(full);
    const now = last !== undefined && last.size === size && last.mtimeMs === mtimeMs
      ? last
      : { size, mtimeMs, file: { path: path.relative(root, full).split(path.sep).join("/"), text: await readText(full) } };
    seen.set(full, now);
    return now.file;
  }

  /** Every code file under `dir`, its path from `root` with forward slashes, read again only if it changed. */
  async function filesUnder(root: string, dir: string, seen: Map<string, Kept>): Promise<SourceFile[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const found = await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : filesUnder(root, full, seen);
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      const file = await fileAt(root, full, seen);
      return file === undefined ? [] : [file];
    }));
    return found.flat();
  }

  async function survey(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
    if (!checkouts.has(folder)) checkouts.set(folder, mainCheckout(folder));
    const checkout = await checkouts.get(folder)!;
    const seen = new Map<string, Kept>();
    const surveys = await Promise.all(tree.stories.map(async (story) => {
      const root = path.join(checkout, "packages", packageOf(story.title));
      const sources = await filesUnder(root, path.join(root, "src"), seen);
      if (sources.length === 0) return [];
      const manifest = await fileAt(root, path.join(root, "package.json"), seen);
      const map = await fileAt(root, path.join(root, COVERAGE_MAP), seen);
      const files = map === undefined ? sources : [...sources, map];
      const capabilities = JSON.stringify(story.capabilities.map(({ id, title }) => [id, title]));
      const last = surveyed.get(story.id);
      const read = manifest === undefined ? undefined : manifestFrom(manifest.text);
      if (last !== undefined && last.capabilities === capabilities && last.files.length === files.length && last.files.every((file, at) => file === files[at])) return [[story.id, last.survey, read] as const];
      const fresh = surveyStory(sources, story.capabilities, map === undefined ? {} : coverageFrom(map.text));
      surveyed.set(story.id, { files, capabilities, survey: fresh });
      return [[story.id, fresh, read] as const];
    }));
    // Each story's package dependencies on other stories' packages, by package name.
    const storyOf = new Map(surveys.flat().flatMap(([id, , read]) => (read === undefined ? [] : [[read.name, id] as const])));
    const withEdges = surveys.flat().map(([id, base, read]) => {
      if (read === undefined) return [id, base] as const;
      const dependsOn = read.deps.flatMap((dep) => { const other = storyOf.get(dep); return other === undefined || other === id ? [] : [other]; });
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
