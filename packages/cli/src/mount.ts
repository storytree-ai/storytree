// Capability 1 · Front door
import type { Library, PluginRecordKind, Storytree, SurveyedPart } from "@storytree/library";
import type { Composition, PartsGraph } from "@storytree/plugin-loader";
import type { ProvidingFamily } from "@storytree/plugin-loader/switch";
import { consumersOf, mounted, VerbRefusal, WHERE_INPUTS, whereOf, writtenLibrary, type DoorWords, type Verb, type VerbContext, type VerbFamilies, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

import { Refusal, type Next } from "./answer.js";
import { commandInput, commandUsage } from "./command-input.js";
import type { Args } from "./args.js";
import type { Claim, ClaimContext, Context, Verb as Command, Family } from "./door.js";
import { commandSession, soleSession } from "./writer.js";

const WORDS: DoorWords = {
  door: "command",
  say: (step) => step.command === undefined ? `the ${step.tool!} tool` : `storytree ${step.command}`,
};

export type CommandCaller = VerbContext & Pick<ClaimContext, "log">;

export interface CommandPlace extends VerbPlace {
  readonly script?: string;
  journey: Context["journey"];
  out(text: string): void;
  surfaces(): Promise<readonly SurfaceDeclaration[]>;
  parts(): Promise<PartsGraph>;
  hostVerbs(): Promise<Composition<ProvidingFamily>>;
  projectRecords(): Promise<readonly ProjectRecords[]>;
  claims(): Promise<readonly Claim[]>;
  testedNumbers(capability: string): Promise<{ tested: string[]; untested: string[] }>;
  placeFiles(paths: readonly string[]): Promise<readonly FilePlaceOf[]>;
  pluginInFactory(plugin: string): Promise<boolean>;
  levelsBehind(story: string, parent: string): Promise<string[]>;
}

type FilePlaceOf = Awaited<ReturnType<typeof import("@storytree/map/code-survey").placeFiles>>[number];

export type SurfaceDeclaration = object;

export interface ProjectRecords {
  readonly name: string;
  forget(server: Storytree, project: string): Promise<void>;
}

async function surfaces(): Promise<readonly SurfaceDeclaration[]> {
  const [{ mount }, { readPartsOff }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount((await import("#parts/surfaces")).default, readPartsOff()).mounted;
}

export async function projectRecords(home?: string): Promise<readonly ProjectRecords[]> {
  const [{ mount, standIn }, { readPartsOff, readStandIns }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount(standIn((await import("#parts/projectRecords")).default, "projectRecords", readStandIns(home)), readPartsOff(home)).mounted;
}

export interface ArmCheck {
  readonly name: string;
  verdict(door: "tool" | "command", verb: string, home?: string): { readonly allowed: true } | { readonly allowed: false; readonly message: string };
}

export async function armChecks(home?: string): Promise<readonly ArmCheck[]> {
  const [{ mount, standIn }, { readPartsOff, readStandIns }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount(standIn((await import("#parts/armChecks")).default, "armChecks", readStandIns(home)), readPartsOff(home)).mounted;
}

async function hostVerbs(): Promise<Composition<ProvidingFamily>> {
  return (await import("#parts/verbs")).default;
}

async function parts(): Promise<PartsGraph> {
  return (await import("#parts/surfaces")).default.graph;
}

export async function recordKindsMounted(): Promise<{ kinds: PluginRecordKind[]; said: string[] }> {
  const [{ offSaid, recordKinds, switchedOff }, { readPartsOff, readStandIns }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  let off: readonly string[];
  let standIns: ReturnType<typeof readStandIns>;
  try {
    off = readPartsOff();
    standIns = readStandIns();
  } catch {
    return { kinds: [], said: [] };
  }
  const graph = await parts();
  const { kinds, failed } = recordKinds(graph, standIns, off);
  const because = switchedOff(graph, off);
  return { kinds, said: Object.entries(failed).map(([part, why]) => offSaid({ part, because: because.get(part) ?? part, failed: why })) };
}

async function testedNumbersOf(cwd: string, library: Library, capability: string): Promise<{ tested: string[]; untested: string[] }> {
  const { testedNumbers, untestedContracts } = await import("@storytree/map/code-survey");
  const tree = await library.projectTree();
  const tested = await testedNumbers(cwd, tree, capability);
  return { tested, untested: untestedContracts(tree, capability, tested) };
}

async function placeFilesOf(cwd: string, library: Library, paths: readonly string[]): Promise<FilePlaceOf[]> {
  const { placeFiles } = await import("@storytree/map/code-survey");
  return placeFiles(cwd, paths, await library.projectTree());
}

async function levelsBehindOf(cwd: string, library: Library, story: string, parent: string): Promise<string[]> {
  const { codeSurveyReader } = await import("@storytree/map/code-survey");
  const tree = await library.projectTree();
  const survey = await codeSurveyReader({ checkout: "current" }).read(cwd, { ...tree, stories: tree.stories.filter(({ id }) => id === story) });
  const folders = (parts: readonly SurveyedPart[]): string[] => parts.flatMap((part) => [part.folder, ...folders(part.parts)]);
  return folders(survey[story]?.parts?.capabilities[parent] ?? []);
}

async function pluginInFactory(plugin: string): Promise<boolean> {
  const [{ factoryFolder }, { pluginFor }] = await Promise.all([import("@storytree/project-and-caller"), import("@storytree/plugin-loader/factory")]);
  try {
    pluginFor(factoryFolder().folder, plugin);
    return true;
  } catch {
    return false;
  }
}

export function command(declared: Verb<VerbInputs, CommandCaller & CommandPlace>): Command {
  if (!mounted(declared.command)) throw new Error(`no command to mount: ${declared.command.absent}`);
  const face = declared.command;
  const where = wherePlaces(declared);
  const taking = { ...declared, inputs: { ...declared.inputs, ...Object.fromEntries(where.map((key) => [key, WHERE_INPUTS[key]])) } };
  const usage = face.usage === undefined || where.length === 0 ? commandUsage(taking) : `${face.usage} ${where.map((key) => `[--${key} <${key}>]`).join(" ")}`;
  const switches = Object.entries(declared.inputs).flatMap(([name, input]) => input.kind === "switch" ? [name] : []);
  const misused = (error: VerbRefusal): Refusal => new Refusal(error.misuse ? `${error.message}\nusage: storytree ${usage}` : error.message, {
    code: error.misuse ? 2 : 1,
    next: error.next.map((step) => ({ command: WORDS.say(step), why: step.why })),
  });
  return {
    name: face.name,
    usage,
    summary: face.summary,
    switches,
    consumers: consumersOf(declared),
    async act(args, context) {
      try {
        const given = commandInput(taking, { word: (index) => args.words[index], flag: (name) => args.text(name), flags: (name) => args.texts(name), has: (name) => args.has(name), names: () => args.names });
        const named = whereOf({ ...fieldsOf(declared, given), ...given });
        const input = Object.fromEntries(Object.entries(given).filter(([key]) => !(where as readonly string[]).includes(key)));
        if (declared.agentOnly !== undefined && commandSession() === undefined) throw new Refusal(`Run storytree ${face.family} ${face.name} from the agent's shell: ${declared.agentOnly}.`);
        const place: CommandPlace = { folder: context.cwd, ...(context.script === undefined ? {} : { script: context.script }), journey: () => context.journey(), out: (text) => context.out(text), surfaces, parts, hostVerbs, projectRecords: () => projectRecords(), claims: () => context.claims(), testedNumbers: async (capability) => testedNumbersOf(context.cwd, await context.library(), capability), placeFiles: async (paths) => placeFilesOf(context.cwd, await context.library(), paths), pluginInFactory, levelsBehind: async (story, parent) => levelsBehindOf(context.cwd, await context.library(), story, parent) };
        const opened = declared.callerless ? { ...place, ...soleSession() } as CommandCaller & CommandPlace : { ...place, ...await context.activityContext() };
        const written = !declared.writes || declared.callerless ? undefined : await writtenLibrary(opened.library, named);
        const caller = written === undefined ? opened : { ...opened, library: written, claims: () => context.claims(written.name) };
        const answer = await declared.act(input, declared.writes ? writing(caller, context) : caller, WORDS);
        if (answer.raw) return { text: answer.text, raw: true };
        const next: Next[] = (answer.next ?? []).map((step) => ({ command: WORDS.say(step), why: step.why }));
        return { text: answer.text, ...(next.length === 0 ? {} : { next }) };
      } catch (error) {
        throw error instanceof VerbRefusal ? misused(error) : error;
      }
    },
  };
}

function wherePlaces(declared: Verb<VerbInputs, never>): (keyof typeof WHERE_INPUTS)[] {
  if (!declared.writes || declared.callerless) return [];
  const added = (Object.keys(WHERE_INPUTS) as (keyof typeof WHERE_INPUTS)[]).filter((key) => !(key in declared.inputs));
  return Object.values(declared.inputs).some((one) => one.kind === "fields") ? added.filter((key) => key === "project") : added;
}

function fieldsOf(declared: Verb<VerbInputs, never>, given: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const name = Object.entries(declared.inputs).find(([, one]) => one.kind === "fields")?.[0];
  const fields = name === undefined ? undefined : given[name];
  return typeof fields === "object" && fields !== null ? fields as Record<string, unknown> : {};
}

function writing<C extends object>(caller: C, context: Pick<Context, "writer">): C & { readonly writer: ReturnType<Context["writer"]> } {
  let writer: ReturnType<Context["writer"]> | undefined;
  return Object.defineProperty({ ...caller }, "writer", { enumerable: true, get: () => (writer ??= context.writer()) }) as C & { readonly writer: ReturnType<Context["writer"]> };
}

export function family(declared: VerbFamilies<CommandCaller & CommandPlace>): Family {
  return {
    name: declared.name,
    ...(declared.aliases === undefined ? {} : { aliases: declared.aliases }),
    summary: declared.summary,
    verbs: declared.verbs.filter((each) => mounted(each.command)).map(command),
    ...(declared.bare === undefined ? {} : { bare: command(declared.bare) }),
    ...(declared.families === undefined ? {} : { families: declared.families.map(family) }),
    ...(declared.guesses === undefined ? {} : { guesses: declared.guesses }),
    ...(declared.retired === undefined ? {} : { retired: declared.retired }),
  };
}

export const WHERE_USAGE = "--project <project> | --arc <arc> | --increment <increment>";

export async function writtenFor(args: Pick<Args, "text">, context: Pick<Context, "library">, usage: string): Promise<Library> {
  const named = whereOf({ project: args.text("project"), arc: args.text("arc"), increment: args.text("increment") });
  try {
    return await writtenLibrary(await context.library(), named);
  } catch (error) {
    throw error instanceof VerbRefusal ? new Refusal(`${error.message}\nusage: storytree ${usage}`, { code: 2 }) : error;
  }
}
