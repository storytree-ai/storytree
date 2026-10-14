/**
 * Capability 3 · The check command (the Guardrails story, ADR-0911 D2): the package rule and the
 * allocation rule run over a checkout together, reported plainly, as `storytree check` prints it. It
 * reads the checkout alone: no plan, no library and no running app, so a user's CI can run it. A checkout
 * that mounts its stories in a frame outside packages/ declares the frame in its storytree.check.json,
 * `{ "frames": [{ "story": …, "dirs": [...] }] }`, as storytree's own does for apps/desktop.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { allocationProblems } from "../allocation-rule/allocation-rule.js";
import { packageProblems, type Declarations } from "../package-rule/package-rule.js";

/** What the check found: each rule's problems, whether both were kept, and the report as printed. */
export interface CheckReport {
  readonly passed: boolean;
  readonly packageRule: readonly string[];
  readonly allocationRule: readonly string[];
  readonly text: string;
}

/** The checkout `folder` is in: its repository's top folder, or `folder` itself when git cannot say. */
export function checkoutOf(folder: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, windowsHide: true }).trim() || folder;
  } catch {
    return folder;
  }
}

/** What the checkout at `root` declares in its storytree.check.json: its frames, or nothing when it has none. */
export function declarationsOf(root: string): Declarations {
  const file = path.join(root, "storytree.check.json");
  if (!existsSync(file)) return {};
  const { frames } = JSON.parse(readFileSync(file, "utf8")) as Pick<Declarations, "frames">;
  return frames === undefined ? {} : { frames };
}

/** Run both rules over the checkout at `root`, with what it declares; a user's project usually declares nothing. */
export async function check(root: string, declared: Declarations = declarationsOf(root)): Promise<CheckReport> {
  const packageRule = packageProblems(root, declared);
  const allocationRule = await allocationProblems(root, declared.stories);
  const passed = packageRule.length === 0 && allocationRule.length === 0;
  const said = (name: string, kept: string, problems: readonly string[]) =>
    problems.length === 0 ? [`${name}: kept (${kept}).`] : [`${name}: ${problems.length} ${problems.length === 1 ? "problem" : "problems"}.`, ...problems.map((problem) => `  - ${problem}`)];
  const text = [
    ...said("The package rule", "one package per story, roads one way", packageRule),
    ...said("The allocation rule", "every source file is reached by a numbered test", allocationRule),
    passed ? "storytree check passed." : "storytree check failed: fix each problem above, then run it again.",
  ].join("\n");
  return { passed, packageRule, allocationRule, text };
}
