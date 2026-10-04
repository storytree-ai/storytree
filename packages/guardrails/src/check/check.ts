/**
 * Capability 3 · The check command (the Guardrails story, ADR-0911 D2): the package rule and the
 * allocation rule run over a checkout together, reported plainly, as `storytree check` prints it. It
 * reads the checkout alone: no plan, no library and no running app, so a user's CI can run it.
 */
import { execFileSync } from "node:child_process";

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

/** Run both rules over the checkout at `root`; a user's project declares nothing. */
export async function check(root: string, declared: Declarations = {}): Promise<CheckReport> {
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
