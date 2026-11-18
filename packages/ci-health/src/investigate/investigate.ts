// Capability 3 · Reading the project's CI.
import type { FlakeSeen, Library, WriteOptions } from "@storytree/library";
import { packagesOf } from "@storytree/map/package-of";

import type { PlanTree } from "../verdicts/verdicts.js";

export type FlakyTest = Omit<FlakeSeen, "story" | "of" | "contract"> & { readonly unit?: string };

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

export async function investigateFlakyTest(library: Library, { unit, ...flake }: FlakyTest, write: WriteOptions = {}): Promise<string | undefined> {
  return library.investigateFlake({ ...flake, ...placeOf(await library.projectTree(), { ...(unit === undefined ? {} : { unit }) }, flake.test) }, write);
}
