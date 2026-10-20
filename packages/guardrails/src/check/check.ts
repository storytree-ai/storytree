/**
 * Capability 3 · The check command (the Guardrails story, ADR-0911 D2): the package rule, the allocation
 * rule and the graduated checks (capability 4) run over a checkout together, reported plainly, as `storytree check` prints it. It
 * reads the checkout alone: no plan, no library and no running app, so a user's CI can run it. A checkout
 * that mounts its stories in a frame outside packages/ declares the frame in its storytree.check.json,
 * `{ "frames": [{ "story": …, "dirs": [...] }] }`, as storytree's own does for apps/desktop, and beside
 * it the owner's sanctioned story-to-frame edges, `"edges": [{ "from", "to", "said", "on" }]` (ADR-0847 D2).
 * The placement report (capability 5) is printed too, with its settings under `"placement"`, and never fails the check.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { allocationProblems } from "../allocation-rule/allocation-rule.js";
import { graduatedChecks, type GraduatedReport } from "../graduated/graduated.js";
import { packageProblems, type Declarations, type Edge } from "../package-rule/package-rule.js";
import { placementReport, type PlacementFrame, type PlacementReport, type PlacementSettings } from "../placement/placement.js";

/** What a checkout declares: the package rule's declarations, its frames as the placement report reads them, and that report's settings. */
export type CheckDeclarations = Omit<Declarations, "frames"> & { readonly frames?: readonly PlacementFrame[]; readonly placement?: PlacementSettings };

/** What the check found: each rule's problems, what the graduated checks found or why they did not run, the placement report unless it is off, whether all were kept, and the report as printed. */
export interface CheckReport {
  readonly passed: boolean;
  readonly packageRule: readonly string[];
  readonly allocationRule: readonly string[];
  readonly graduated: GraduatedReport;
  readonly placement?: PlacementReport;
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

/** What the checkout at `root` declares in its storytree.check.json: its frames, sanctioned edges and placement settings, or nothing when it has none. */
export function declarationsOf(root: string): CheckDeclarations {
  const file = path.join(root, "storytree.check.json");
  if (!existsSync(file)) return {};
  const { frames, edges, placement } = JSON.parse(readFileSync(file, "utf8")) as { frames?: CheckDeclarations["frames"]; edges?: readonly Edge[]; placement?: PlacementSettings };
  return { ...(frames === undefined ? {} : { frames }), ...(edges === undefined ? {} : { edges: { edges } }), ...(placement === undefined ? {} : { placement }) };
}

/**
 * Run both rules over the checkout at `root`, with what it declares (a user's project usually declares nothing),
 * and the graduated checks on what its branch changes against origin/main. A trip fails the check; without
 * origin/main to compare with, the graduated checks are reported as not run, which never reads as kept.
 */
export async function check(root: string, declared: CheckDeclarations = declarationsOf(root)): Promise<CheckReport> {
  const packageRule = packageProblems(root, declared);
  const allocationRule = await allocationProblems(root, declared.stories);
  const graduated = graduatedChecks(root);
  const placement = declared.placement?.off === true ? undefined : await placementReport(root, declared);
  const trips = graduated.ran ? graduated.trips.map(({ file, line }) => `${file}:${line} asserts an expression equal to itself, so it can never fail.`) : [];
  const passed = packageRule.length === 0 && allocationRule.length === 0 && trips.length === 0;
  const said = (name: string, kept: string, problems: readonly string[]) =>
    problems.length === 0 ? [`${name}: kept (${kept}).`] : [`${name}: ${problems.length} ${problems.length === 1 ? "problem" : "problems"}.`, ...problems.map((problem) => `  - ${problem}`)];
  const text = [
    ...said("The package rule", "one package per story, roads one way", packageRule),
    ...said("The allocation rule", "every source file is reached by a numbered test", allocationRule),
    ...(graduated.ran ? said("The self-equal assertion check", "no changed file asserts an expression equal to itself", trips) : [`The self-equal assertion check: not run (${graduated.reason})`]),
    ...(placement === undefined ? [] : [placement.text]),
    passed ? "storytree check passed." : "storytree check failed: fix each problem above, then run it again.",
  ].join("\n");
  return { passed, packageRule, allocationRule, graduated, ...(placement === undefined ? {} : { placement }), text };
}
