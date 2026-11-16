/**
 * Capability 3 · Story node render (the forest story): what an opened capability draws inside its territory, from its
 * code's own nested parts (the survey's, ADR-1339 D1): a read-only picture holding nothing of the plan (question_211620bd75de).
 *
 * - Each of the capability's outermost parts is a territory, sized by the lines of every file in it, its deeper parts'
 *   included; the capability's own files in no part are one more, named by the capability itself. Fewer than two, and
 *   there is nothing to open.
 * - A road joins two of its parts where a file of one imports a file of the other, one road per pair either way.
 * - Each of the capability's links the code shows, by the files behind it, names the parts it reaches inside: the parts
 *   holding the files it imports (a link in) or the files importing (a link out). A link the code does not show (a
 *   recorded dependency alone) reaches no part: its road ends at the gate.
 * - Each import reaching round a part's front door (the survey's clashes) rides on the road between its ends as the
 *   capability shows them: the parts holding its files, or for a file of another capability of the story, that capability.
 *   The road names the part it reaches. One with both ends in one part, or neither in the capability, rides on none.
 */
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { StorySurvey, SurveyedPart } from "@storytree/library";

/**
 * One of a capability's parts as a territory: its folder (the capability's own id for its files in no part), its name and its
 * lines; a top part's capabilities (top-parts.ts) also carry their own word, description and whether parked.
 */
export type PartShare = { readonly capability: string; readonly title: string; readonly lines: number; readonly status?: CapabilityWord; readonly parked?: true; readonly description?: string };

/** An opened capability's drawing data: its parts, the roads between them, the parts each of its links reaches, by the link's
 * `from->to`, and the parts reached round a front door by the imports each road carries, by the road's `from->to`. */
export type SceneParts = {
  readonly story: string;
  readonly capability: string;
  readonly shares: readonly PartShare[];
  readonly links: readonly { readonly from: string; readonly to: string }[];
  readonly lanes: Readonly<Record<string, readonly string[]>>;
  /** Absent on a top part's, whose parts are capabilities. */
  readonly clashes?: Readonly<Record<string, readonly string[]>>;
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (folder: string): string => folder.slice(folder.lastIndexOf("/") + 1);

/** Every file a part holds, its deeper parts' included. */
function filesOf(part: SurveyedPart): string[] {
  return [...part.files, ...part.parts.flatMap(filesOf)];
}

/**
 * The parts of every capability of every story `surveys` holds that has two or more to draw, by story; `titles` names
 * each capability (its own files' territory takes its name).
 */
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

/** One capability's parts, or undefined with fewer than two territories to draw. */
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

  // Each link of the capability the code shows, and the parts its files reach here.
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

  // Each import reaching round a part's front door, on the road between its ends as shown here.
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
