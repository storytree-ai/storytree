/**
 * Capability 8 · Code survey, read from disk: each story's package in a project's checkout, surveyed.
 * Node only (the app's main process reads it; the page cannot reach the disk).
 *
 * - The checkout is the main one of the folder's repository, so a session's worktree never stands in
 *   for the project's code.
 * - A story's package is the one named after its title ("The agent link" is packages/agent-link),
 *   but for a story whose package was named otherwise; a story with no such package has no code yet.
 * - Surveying again reads only what changed (ADR-0836 D2): a file whose size and modified time are as
 *   last read is not read again, a story none of whose files changed keeps its survey, the checkout is
 *   found once per folder without blocking, and one survey of a folder runs at a time.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf, surveyStory, type SourceFile, type StorySurvey } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

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

export function codeSurveyReader({ readFile: readText = (file: string) => readFile(file, "utf8") }: { readFile?(file: string): Promise<string> } = {}): CodeSurveyReader {
  const checkouts = new Map<string, Promise<string>>();
  const kept = new Map<string, Kept>();
  const surveyed = new Map<string, { readonly files: readonly SourceFile[]; readonly capabilities: string; readonly survey: StorySurvey }>();
  const running = new Map<string, Promise<ProjectSurvey>>();

  /** Every code file under `dir`, its path from `root` with forward slashes, read again only if it changed. */
  async function filesUnder(root: string, dir: string, seen: Map<string, Kept>): Promise<SourceFile[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const found = await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : filesUnder(root, full, seen);
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      const { size, mtimeMs } = await stat(full);
      const last = kept.get(full);
      const now = last !== undefined && last.size === size && last.mtimeMs === mtimeMs
        ? last
        : { size, mtimeMs, file: { path: path.relative(root, full).split(path.sep).join("/"), text: await readText(full) } };
      seen.set(full, now);
      return [now.file];
    }));
    return found.flat();
  }

  async function survey(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
    if (!checkouts.has(folder)) checkouts.set(folder, mainCheckout(folder));
    const checkout = await checkouts.get(folder)!;
    const seen = new Map<string, Kept>();
    const surveys = await Promise.all(tree.stories.map(async (story) => {
      const root = path.join(checkout, "packages", packageOf(story.title));
      const files = await filesUnder(root, path.join(root, "src"), seen);
      if (files.length === 0) return [];
      const capabilities = JSON.stringify(story.capabilities.map(({ id, title }) => [id, title]));
      const last = surveyed.get(story.id);
      if (last !== undefined && last.capabilities === capabilities && last.files.length === files.length && last.files.every((file, at) => file === files[at])) return [[story.id, last.survey] as const];
      const fresh = surveyStory(files, story.capabilities);
      surveyed.set(story.id, { files, capabilities, survey: fresh });
      return [[story.id, fresh] as const];
    }));
    for (const full of kept.keys()) if (full.startsWith(checkout + path.sep) && !seen.has(full)) kept.delete(full);
    for (const [full, now] of seen) kept.set(full, now);
    return Object.fromEntries(surveys.flat());
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
