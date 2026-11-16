/**
 * Capability 3 · Story node render (the forest story): an imported island opens top-down (question_a70f36ca932a,
 * arc_0c4277f81731). Its capabilities are the deepest folders of its code (ADR-1324 D1), so they are grouped by the top
 * folder each sits in, and the island shows those top parts first, each opening into the capabilities inside it.
 *
 * - A capability's top folder is the first folder of its first cover (in path order) below the folders every explored
 *   capability's first cover shares (its source root). A cover with no folder below that is its own.
 * - A top folder holding two or more explored capabilities with code is one top part: titled by the folder, sized by their
 *   lines, its word rolled up from theirs (red if any unparked one is, else yellow if any unparked one is not green, else
 *   green; grey only when every one is parked). A capability alone in its top folder stays a territory of its own, so a
 *   flat island draws as before.
 * - The brown unexplored rest stays one territory at the island's level, beside the top parts (3.50).
 */
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { StorySurvey } from "@storytree/library";

/** An explored capability as the scene reads it. */
export type Explored = { readonly id: string; readonly title: string; readonly description?: string; readonly status: CapabilityWord; readonly parkedOn?: readonly unknown[]; readonly covers?: readonly string[] };

/** One top part: its territory's id, its folder, and the capabilities inside it, with each one's lines. */
export type TopPart = { readonly id: string; readonly folder: string; readonly members: readonly (Explored & { readonly lines: number })[] };

const TOP = "top:";

/** A top part's id, from its story and its folder. */
export const topId = (story: string, folder: string): string => `${TOP}${story}:${folder}`;

/** Whether territory or link end `id` is a top part rather than a capability. */
export const isTopPart = (id: string | undefined): boolean => id?.startsWith(TOP) === true;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The top parts of mapped story `story` with `capabilities`, from `survey`'s files, in folder order. */
export function topParts(story: string, capabilities: readonly Explored[], survey: StorySurvey | undefined): TopPart[] {
  const files = survey?.files ?? [];
  const linesOf = (capability: string) => files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  const drawn = capabilities.flatMap((capability) => {
    const first = [...capability.covers ?? []].sort(byText)[0];
    const lines = linesOf(capability.id);
    return first === undefined || lines === 0 ? [] : [{ capability: { ...capability, lines }, path: first.split("/").filter((step) => step !== "" && step !== ".") }];
  });
  if (drawn.length < 2) return [];
  let shared = 0;
  while (drawn.every(({ path }) => path.length > shared + 1 && path[shared] === drawn[0]!.path[shared])) shared++;
  const byFolder = new Map<string, TopPart["members"][number][]>();
  for (const { capability, path } of drawn) {
    if (path.length <= shared + 1) continue;
    const folder = path[shared]!;
    byFolder.set(folder, [...byFolder.get(folder) ?? [], capability]);
  }
  return [...byFolder].filter(([, members]) => members.length >= 2).sort(([a], [b]) => byText(a, b))
    .map(([folder, members]) => ({ id: topId(story, folder), folder, members }));
}

/** A top part's word and whether it is parked, rolled up from its members'. */
export function rolledWord(members: TopPart["members"]): { status: CapabilityWord; parked?: true } {
  const live = members.filter(({ parkedOn }) => parkedOn === undefined);
  if (live.length === 0) return { status: "proposed", parked: true };
  if (live.some(({ status }) => status === "unhealthy")) return { status: "unhealthy" };
  if (live.some(({ status }) => status === "proposed")) return { status: "proposed" };
  if (live.some(({ status }) => status === "untested")) return { status: "untested" };
  return { status: "healthy" };
}
