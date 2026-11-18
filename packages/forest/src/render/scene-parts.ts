// Capability 3 · Story node render
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { StorySurvey, SurveyedPart } from "@storytree/library";

export type PartShare = { readonly capability: string; readonly title: string; readonly lines: number; readonly status?: CapabilityWord; readonly parked?: true; readonly description?: string };

export type SceneParts = {
  readonly story: string;
  readonly capability: string;
  readonly shares: readonly PartShare[];
  readonly links: readonly { readonly from: string; readonly to: string }[];
  readonly lanes: Readonly<Record<string, readonly string[]>>;
  readonly clashes?: Readonly<Record<string, readonly string[]>>;
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (folder: string): string => folder.slice(folder.lastIndexOf("/") + 1);

function filesOf(part: SurveyedPart): string[] {
  return [...part.files, ...part.parts.flatMap(filesOf)];
}

export function sceneParts(surveys: Readonly<Record<string, StorySurvey>>, titles: ReadonlyMap<string, string> = new Map()): SceneParts[] {
  const found: SceneParts[] = [];
  for (const [story, survey] of Object.entries(surveys).sort(([a], [b]) => byText(a, b))) {
    for (const [capability, parts] of Object.entries(survey.parts?.capabilities ?? {}).sort(([a], [b]) => byText(a, b))) {
      const opened = capabilityParts(story, capability, parts, surveys, titles.get(capability) ?? capability);
      if (opened !== undefined) found.push(opened);
    }
  }
  return found;
}

export function capabilityParts(story: string, capability: string, parts: readonly SurveyedPart[], surveys: Readonly<Record<string, StorySurvey>>, title: string): SceneParts | undefined {
  const survey = surveys[story];
  if (survey === undefined) return undefined;
  const own = survey.files.filter((file) => file.capability === capability);
  const lines = new Map(own.map((file) => [file.path, file.lines]));
  const partOf = new Map<string, string>();
  for (const part of parts) for (const file of filesOf(part)) partOf.set(file, part.folder);
  for (const file of own) if (!partOf.has(file.path)) partOf.set(file.path, capability);
  const sum = (files: readonly string[]) => files.reduce((total, file) => total + (lines.get(file) ?? 0), 0);
  const rest = own.filter((file) => partOf.get(file.path) === capability);
  const shares: PartShare[] = [
    ...[...parts].sort((a, b) => byText(a.folder, b.folder)).map((part) => ({ capability: part.folder, title: nameOf(part.folder), lines: Math.max(1, sum(filesOf(part))) })),
    ...(rest.length === 0 ? [] : [{ capability, title, lines: Math.max(1, sum(rest.map((file) => file.path))) }]),
  ];
  if (shares.length < 2) return undefined;

  const pairs = new Set<string>();
  for (const { from, to } of survey.imports) {
    const [a, b] = [partOf.get(from), partOf.get(to)];
    if (a !== undefined && b !== undefined && a !== b) pairs.add(`${a}->${b}`);
  }
  const links = [...pairs].sort(byText).map((key) => { const [from, to] = key.split("->") as [string, string]; return { from, to }; });

  const reached = new Map<string, Set<string>>();
  const reach = (key: string, file: string | undefined) => {
    const part = file === undefined ? undefined : partOf.get(file);
    if (part === undefined) return;
    reached.set(key, (reached.get(key) ?? new Set()).add(part));
  };
  for (const edge of survey.edges ?? []) if (edge.from === capability && edge.to !== undefined && edge.to !== capability) {
    for (const file of edge.files) reach(`${capability}->${edge.to}`, file.from);
  }
  for (const theirs of Object.values(surveys)) for (const edge of theirs.edges ?? []) {
    if (edge.story !== story || edge.to !== capability || edge.from === undefined || edge.from === capability) continue;
    for (const file of edge.files) reach(`${edge.from}->${capability}`, file.to);
  }
  const sorted = (found: Map<string, Set<string>>) => Object.fromEntries([...found].sort(([a], [b]) => byText(a, b)).map(([key, set]) => [key, [...set].sort(byText)]));
  const lanes = sorted(reached);

  const capabilityOf = new Map(survey.files.map((file) => [file.path, file.capability]));
  const end = (file: string) => partOf.get(file) ?? capabilityOf.get(file);
  const reaching = new Map<string, Set<string>>();
  for (const clash of survey.parts?.clashes ?? []) {
    const [a, b] = [end(clash.from), end(clash.to)];
    if (a === undefined || b === undefined || a === b || !(partOf.has(clash.from) || partOf.has(clash.to))) continue;
    reaching.set(`${a}->${b}`, (reaching.get(`${a}->${b}`) ?? new Set()).add(clash.part));
  }
  return { story, capability, shares, links, lanes, clashes: sorted(reaching) };
}
