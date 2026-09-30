/**
 * Capability 8 · Code survey, read from disk: each story's package in a project's checkout, surveyed.
 * Node only (the app's main process reads it; the page cannot reach the disk).
 *
 * - The checkout is the main one of the folder's repository, so a session's worktree never stands in
 *   for the project's code.
 * - A story's package is the one named after its title ("The agent link" is packages/agent-link),
 *   but for a story whose package was named otherwise; a story with no such package has no code yet.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";

import { packageOf, surveyStory, type SourceFile, type StorySurvey } from "./code-survey.js";

/** Each story's survey, by story id; a story with no package is absent. */
export type ProjectSurvey = Readonly<Record<string, StorySurvey>>;

const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

export { packageOf };

/** The main checkout of the repository `folder` is in, or `folder` itself when git cannot say. */
function mainCheckout(folder: string): string {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, windowsHide: true }).trim();
    return path.basename(common) === ".git" ? path.dirname(common) : folder;
  } catch {
    return folder;
  }
}

/** Every file under `dir`, its path from `root` with forward slashes. */
async function filesUnder(root: string, dir: string): Promise<SourceFile[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(entries.map(async (entry): Promise<SourceFile[]> => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : filesUnder(root, full);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [{ path: path.relative(root, full).split(path.sep).join("/"), text: await readFile(full, "utf8") }];
  }));
  return found.flat();
}

/** The survey of every story in `tree` whose package the checkout at `folder` holds. */
export async function readCodeSurvey(folder: string, tree: AnnotatedTree): Promise<ProjectSurvey> {
  const checkout = mainCheckout(folder);
  const surveys = await Promise.all(tree.stories.map(async (story) => {
    const root = path.join(checkout, "packages", packageOf(story.title));
    const files = await filesUnder(root, path.join(root, "src"));
    return files.length === 0 ? [] : [[story.id, surveyStory(files, story.capabilities)] as const];
  }));
  return Object.fromEntries(surveys.flat());
}
