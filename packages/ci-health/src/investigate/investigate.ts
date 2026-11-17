/**
 * Capability 3 · Reading the project's CI. A flaky test found outside own health (a pull request's or the merge queue's
 * run, which the watcher retried as random) goes to the one investigation of that test, never to friction (ADR-1352 D1):
 * the test's story is read from the unit its run named (a package's folder, or an imported story's), and its contract
 * from the number its title carries, so the library's investigateFlake reaches the same investigation own health's
 * flakes of that test reach (library 5.33).
 */
import type { FlakeSeen, Library, WriteOptions } from "@storytree/library";
import { packagesOf } from "@storytree/map/package-of";

import type { PlanTree } from "../verdicts/verdicts.js";

/** A flaky test as the command line names it: its title, the unit its run named, and the flake's own words. */
export type FlakyTest = Omit<FlakeSeen, "story" | "of" | "contract"> & { readonly unit?: string };

/**
 * Where flaky test `flake` belongs in `tree`: the story owning its unit (`packages/<folder>`, or an imported story's
 * folder), and that story's contract its title's number names ("1.2 · …", "cart 1.2 …", "form › 1.2 …"). A unit no
 * story owns stands for the story itself; with no unit, the test's title alone does.
 */
export function placeOf(tree: PlanTree, { unit }: Pick<FlakyTest, "unit">, test: string): Pick<FlakeSeen, "story" | "of" | "contract"> {
  const folder = unit === undefined ? undefined : unit.replace(/^\.\/|\/$/g, "");
  const story = folder === undefined ? undefined : tree.stories.find((one) => (folder.startsWith("packages/") && packagesOf(one).includes(folder.slice("packages/".length)))
    || (one.mapped?.folders ?? []).some((mapped) => mapped.replace(/^\.\/?|\/$/g, "") === folder));
  if (story === undefined) return { of: folder ?? "unplaced" };
  const number = /(?:^|\s)(\d+\.\d+)(?:\s|$)/.exec(test)?.[1];
  const contract = number === undefined ? undefined
    : [...story.capabilities, ...(story.edges ?? [])].flatMap((part) => part.contracts).find(({ title }) => title.startsWith(`${number} · `));
  return { story: story.id, ...(contract === undefined ? {} : { contract: contract.id }) };
}

/** Park, or add `flake` to, the one investigation of its test in `library`, written as `write` says (ADR-1352 D1): the investigation, or undefined when the test is not to be investigated. */
export async function investigateFlakyTest(library: Library, { unit, ...flake }: FlakyTest, write: WriteOptions = {}): Promise<string | undefined> {
  return library.investigateFlake({ ...flake, ...placeOf(await library.projectTree(), { ...(unit === undefined ? {} : { unit }) }, flake.test) }, write);
}
