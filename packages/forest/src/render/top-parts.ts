// Capability 3 · Story node render
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { StorySurvey } from "@storytree/library";

export type Explored = { readonly id: string; readonly title: string; readonly description?: string; readonly status: CapabilityWord; readonly parkedOn?: readonly unknown[]; readonly covers?: readonly string[] };

export type TopPart = { readonly id: string; readonly folder: string; readonly members: readonly (Explored & { readonly lines: number })[] };

const TOP = "top:";

export const topId = (story: string, folder: string): string => `${TOP}${story}:${folder}`;

export const isTopPart = (id: string | undefined): boolean => id?.startsWith(TOP) === true;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

export function rolledWord(members: TopPart["members"]): { status: CapabilityWord; parked?: true } {
  const live = members.filter(({ parkedOn }) => parkedOn === undefined);
  if (live.length === 0) return { status: "proposed", parked: true };
  if (live.some(({ status }) => status === "unhealthy")) return { status: "unhealthy" };
  if (live.some(({ status }) => status === "proposed")) return { status: "proposed" };
  if (live.some(({ status }) => status === "untested")) return { status: "untested" };
  return { status: "healthy" };
}
