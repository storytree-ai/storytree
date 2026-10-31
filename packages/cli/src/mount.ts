/**
 * Capability 1 · Front door. A verb its owning story declared once (ADR-0969 D2), mounted as a command: its usage is
 * read from the verb's inputs, its words and flags become the verb's input, a step it offers next is named as a
 * command, and the verb's own refusal is the door's, with the usage when the input was wrong. A word or flag the verb does
 * not take is refused with its usage, and a refusal's next steps are named as commands. A callerless verb is handed only
 * its place, with the shell's session when it names one alone, so it runs where no library opens. A
 * verb that writes is handed the writer, named below its answer once its work asks for it, so one that wrote nothing names
 * none; a raw answer is printed as it is. The verb's consumers go with it, for a reading of the doors. A declared family is
 * mounted with the families within it, its bare verb, its guesses and its retired words.
 */
import type { Library, PluginRecordKind, Storytree } from "@storytree/library";
import type { Composition, PartsGraph } from "@storytree/plugin-loader";
import type { ProvidingFamily } from "@storytree/plugin-loader/switch";
import { consumersOf, mounted, VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbFamilies, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

import { Refusal, type Next } from "./answer.js";
import { commandInput, commandUsage } from "./command-input.js";
import type { Claim, ClaimContext, Context, Verb as Command, Family } from "./door.js";
import { commandSession, soleSession } from "./writer.js";

const WORDS: DoorWords = {
  door: "command",
  say: (step) => step.command === undefined ? `the ${step.tool!} tool` : `storytree ${step.command}`,
};

/**
 * The caller this door hands a verb, with the activity log its work reads and writes: the door's own copy of
 * Session management's verb context (ADR-1017 D2).
 */
export type CommandCaller = VerbContext & Pick<ClaimContext, "log">;

/**
 * What this door hands every verb besides its caller: the command's own script, when known (storytree's other commands
 * sit beside an installed one), the per-process journey runtime, which the door finishes after the answer, where a line
 * is printed before the answer (sign-in's code while it waits), the app's surfaces this host's story packages declare, the
 * records they keep for a project outside its library, and what the library's verbs read from above the library: the
 * project's claims and the contract numbers a story package's tests carry.
 */
export interface CommandPlace extends VerbPlace {
  readonly script?: string;
  journey: Context["journey"];
  out(text: string): void;
  surfaces(): Promise<readonly SurfaceDeclaration[]>;
  /** The host's parts, each with the parts it stands on (ADR-1095): what `settings set part` switches. */
  parts(): Promise<PartsGraph>;
  /** The host's command families, each with the part that declares it: what `settings set part` says a switch takes away, and `plugin check` a stand-in lacks. */
  hostVerbs(): Promise<Composition<ProvidingFamily>>;
  /** The records the parts this computer mounts keep for a project outside its library, which `project delete` forgets with it. */
  projectRecords(): Promise<readonly ProjectRecords[]>;
  /** The project's claims, which the library's `edit` and `retire` read for the increment the caller holds (ADR-0966). */
  claims(): Promise<readonly Claim[]>;
  /** The contract numbers `capability`'s story package's numbered tests carry in this checkout, and its planned contracts none carries. */
  testedNumbers(capability: string): Promise<{ tested: string[]; untested: string[] }>;
}

/** A surface a story's manifest declares: the door hands the list on and reads none of its fields (ADR-1017 D2). */
export type SurfaceDeclaration = object;

/** Records a story's manifest contributes under `projectRecords` (ADR-1170 D2): the door's own copy of the shape (ADR-1017 D2). */
export interface ProjectRecords {
  readonly name: string;
  forget(server: Storytree, project: string): Promise<void>;
}

/**
 * The app's surfaces, as each story's manifest declares them (ADR-0750, ADR-1021), in the order the Surfaces menu lists
 * them, but those of a part this computer switches off (ADR-1095).
 */
async function surfaces(): Promise<readonly SurfaceDeclaration[]> {
  const [{ mount }, { readPartsOff }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount((await import("#parts/surfaces")).default, readPartsOff()).mounted;
}

/**
 * The project records the story packages contribute (code review's QA ledger), but those of a part switched off in
 * `home`, with a factory plugin's in the place of a part it stands in for, so a project is deleted with no import of
 * the part that keeps them.
 */
export async function projectRecords(home?: string): Promise<readonly ProjectRecords[]> {
  const [{ mount, standIn }, { readPartsOff, readStandIns }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount(standIn((await import("#parts/projectRecords")).default, "projectRecords", readStandIns(home)), readPartsOff(home)).mounted;
}

/**
 * A check a story's manifest contributes under `armChecks`: whether a door may run a verb for a caller whose storytree
 * home is `home`, or the experiment arm that denies it, with why (ADR-1064 D2): the door's own copy of the shape (ADR-1017 D2).
 */
export interface ArmCheck {
  readonly name: string;
  verdict(door: "tool" | "command", verb: string, home?: string): { readonly allowed: true } | { readonly allowed: false; readonly message: string };
}

/**
 * The arm checks the story packages contribute (experiments' arm switch), but those of a part switched off in `home`,
 * with a factory plugin's in the place of a part it stands in for, so the door enforces an arm with no import of the
 * part that keeps arms, and with none mounted runs every command.
 */
export async function armChecks(home?: string): Promise<readonly ArmCheck[]> {
  const [{ mount, standIn }, { readPartsOff, readStandIns }] = await Promise.all([import("@storytree/plugin-loader"), import("@storytree/project-and-caller")]);
  return mount(standIn((await import("#parts/armChecks")).default, "armChecks", readStandIns(home)), readPartsOff(home)).mounted;
}

/** The host's command families, as its story packages' manifests declare them, each with the part that declares it. */
async function hostVerbs(): Promise<Composition<ProvidingFamily>> {
  return (await import("#parts/verbs")).default;
}

/** The host's parts graph: the same for every kind it composes. */
async function parts(): Promise<PartsGraph> {
  return (await import("#parts/surfaces")).default.graph;
}

/**
 * The kinds of record the factory plugins this host mounts declare (ADR-1178 D3), which the project's library is opened
 * with, and a line for each part whose stand-in's kinds could not be read, said as a stand-in that failed is. A settings
 * file that cannot be read mounts none, and the command that reads it next says why.
 */
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

/**
 * The contract numbers `capability`'s story package's numbered tests carry in the checkout `cwd` is in, and the
 * titles of its planned contracts none of them carries yet.
 */
async function testedNumbersOf(cwd: string, library: Library, capability: string): Promise<{ tested: string[]; untested: string[] }> {
  const { testedNumbers, untestedContracts } = await import("@storytree/map/code-survey");
  const tree = await library.projectTree();
  // The survey reads the checkout `cwd` is in, from its top.
  const tested = await testedNumbers(cwd, tree, capability);
  return { tested, untested: untestedContracts(tree, capability, tested) };
}

/**
 * The command for `declared`, which must have one. Its context is the caller's, with the activity log, and this door's
 * place; a callerless verb's is the place alone, the folder the command runs in and the shell's sole session, and no
 * library is opened for it.
 */
export function command(declared: Verb<VerbInputs, CommandCaller & CommandPlace>): Command {
  if (!mounted(declared.command)) throw new Error(`no command to mount: ${declared.command.absent}`);
  const face = declared.command;
  const usage = commandUsage(declared);
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
        const input = commandInput(declared, { word: (index) => args.words[index], flag: (name) => args.text(name), flags: (name) => args.texts(name), has: (name) => args.has(name), names: () => args.names });
        if (declared.agentOnly !== undefined && commandSession() === undefined) throw new Refusal(`Run storytree ${face.family} ${face.name} from the agent's shell: ${declared.agentOnly}.`);
        const place: CommandPlace = { folder: context.cwd, ...(context.script === undefined ? {} : { script: context.script }), journey: () => context.journey(), out: (text) => context.out(text), surfaces, parts, hostVerbs, projectRecords: () => projectRecords(), claims: () => context.claims(), testedNumbers: async (capability) => testedNumbersOf(context.cwd, await context.library(), capability) };
        const caller = declared.callerless ? { ...place, ...soleSession() } as CommandCaller & CommandPlace : { ...place, ...await context.activityContext() };
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

/** `caller` with the writer, asked of the door only when the work first reads it: the door names a writer it was asked for. */
function writing<C extends object>(caller: C, context: Pick<Context, "writer">): C & { readonly writer: ReturnType<Context["writer"]> } {
  let writer: ReturnType<Context["writer"]> | undefined;
  return Object.defineProperty({ ...caller }, "writer", { enumerable: true, get: () => (writer ??= context.writer()) }) as C & { readonly writer: ReturnType<Context["writer"]> };
}

/** The family for `declared`, with the families within it, each verb mounted as a command but one whose command is declared absent (a tool alone). */
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
