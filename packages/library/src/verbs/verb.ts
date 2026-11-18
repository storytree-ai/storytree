/**
 * Capability 16 · The command schema (ADR-1035 D1, ADR-0969 D2): the shapes a verb is declared with, once, by the story
 * that owns its work, which both front doors mount: the command line (`storytree <family> <verb>`) and the MCP server (a
 * tool). A declaration is its name on each door (or why a door does not mount it), one description of its inputs, one
 * piece of work done for the calling session, and one answer: a sentence, data, and next steps each door words in its
 * own terms. The library holds the schema so every story downstream, the library's own included, imports it; reading a
 * door's words into a verb's input is each door's own code (ADR-1035 D2). What else a verb's work needs, such as
 * Session management's activity log, its declaring story adds to the context it types. A verb that writes a library
 * names where the write goes (WHERE_INPUTS, ADR-1348 D3), and `writtenLibrary` reads the library it names.
 *
 * Nothing here loads anything: a door's menus read declarations at start, and the work a verb does is imported
 * inside its act.
 */
import type { Library, Storytree } from "../index.js";
import type { WriteOptions } from "../schema/index.js";
import { sqlState } from "../project/connection-error.js";

/**
 * One input. `text` is a non-empty string, a command's word at `word` when given, else its `--flag <value>`, and
 * left out it reads as nothing when `optional`, and given as only whitespace it is refused unless `blank`, which reads it as
 * empty, and kept as given, its leading and trailing whitespace included, when `verbatim`; with `many`, it is every such string, each word from `word` on or each
 * `--flag` given, and left out it reads as none when `optional`. `yes-no` is a boolean, a command's `--flag yes|no`;
 * `switch` is a boolean that is false unless given, a command's bare `--flag`. `count` is a whole number above 0, a
 * command's `--flag <n>`, and left out it reads as nothing when `optional`. `fields` is an open set: each of a
 * command's `--<field> <value>` its other inputs do not name, by field, its values as given; with `json`, each value is
 * any JSON value, a tool's as given and a command's read by `fieldValue`.
 */
export type VerbInput =
  | { readonly kind: "text"; readonly describe: string; readonly word?: number; readonly optional?: true; readonly many?: true; readonly blank?: true; readonly verbatim?: true }
  | { readonly kind: "yes-no"; readonly describe: string }
  | { readonly kind: "switch"; readonly describe: string }
  | { readonly kind: "count"; readonly describe: string; readonly optional?: true }
  | { readonly kind: "fields"; readonly describe: string; readonly json?: true };

export type VerbInputs = Readonly<Record<string, VerbInput>>;

/** What the inputs come to when the work runs. */
export type InputOf<I extends VerbInputs> = { readonly [K in keyof I]:
  I[K] extends { kind: "text"; many: true } ? readonly string[]
  : I[K] extends { kind: "text"; optional: true } ? string | undefined
  : I[K] extends { kind: "text" } ? string
  : I[K] extends { kind: "yes-no" | "switch" } ? boolean
  : I[K] extends { kind: "count"; optional: true } ? number | undefined
  : I[K] extends { kind: "count" } ? number
  : I[K] extends { kind: "fields"; json: true } ? Readonly<Record<string, unknown>>
  : I[K] extends { kind: "fields" } ? Readonly<Record<string, string>>
  : VerbValue };

/** Any one input's value. */
export type VerbValue = string | number | boolean | undefined | readonly string[] | Readonly<Record<string, unknown>>;

/** A field's value given as text: JSON when it is `true`, `false`, a whole number, a list or an object, else the text. */
export function fieldValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false" || /^-?\d+$/.test(trimmed) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

/** How a door names a step: the tool, the command (after `storytree `), or both. */
export interface Step {
  readonly tool?: string;
  readonly command?: string;
}

/** Which door is answering, and how it names a step: a step the door lacks is named by the other's name. */
export interface DoorWords {
  readonly door: "command" | "tool";
  say(step: Step): string;
}

/**
 * Where a verb was called: all a callerless verb's work is handed, with what its declaring story types beside it, and
 * the calling session and its harness when the door knows them without a library (a shell that names one session).
 */
export interface VerbPlace {
  readonly folder: string;
  readonly session?: string;
  readonly harness?: string;
}

/**
 * Who called, and where: the calling session and its project's library. A story whose verbs need more (Session
 * management's need its activity log) extends this, and the doors that mount those verbs hand it.
 */
export interface VerbContext extends VerbPlace {
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly branch?: string;
  readonly writer?: WriteOptions;
  /** The storytree home the caller's process ledger and claims are kept under, when not the usual one. */
  readonly home?: string;
  /** The library server, for what it keeps beside the projects (Machines' names), when the door has it open. */
  readonly server?: Pick<Storytree, "ownDatabase">;
}

/**
 * A verb's answer: one sentence (or a few lines), what it made or found, and the steps that open what it named; or,
 * `raw`, a value to pipe or save, which the command line prints exactly as it is, with no next steps.
 */
export interface VerbAnswer {
  readonly text: string;
  readonly raw?: true;
  readonly data?: Record<string, unknown>;
  readonly next?: readonly (Step & { readonly why: string })[];
}

/**
 * The verb's own "no": `misuse` when the inputs were wrong, so the command line shows its usage; `next`, the steps that
 * do the job instead, each door naming them in its own terms.
 */
export class VerbRefusal extends Error {
  readonly misuse: boolean;
  readonly next: readonly (Step & { readonly why: string })[];

  constructor(message: string, options: { misuse?: boolean; next?: readonly (Step & { readonly why: string })[] } = {}) {
    super(message);
    this.name = "VerbRefusal";
    this.misuse = options.misuse ?? false;
    this.next = options.next ?? [];
  }
}

/**
 * A door that does not mount a verb says why, so a missing tool or command is declared, never an accident. When that door
 * serves the same job under another declaration (a tool a factory plugin defines apart from its command), `twin` names it as
 * that door does (a tool by its name), so the two are read as one verb.
 */
export interface Absent {
  readonly absent: string;
  readonly twin?: string;
}

/**
 * Who calls a verb: an agent session, a person at the command line or in the app (ADR-1045 D1), or the Mint box's
 * pull-request watcher, which runs with no agent session (ADR-1280 D1).
 */
export type Consumer = "agent" | "user" | "watcher";

export interface Verb<I extends VerbInputs = VerbInputs, C extends VerbPlace = VerbContext> {
  /** `storytree <family> <name>`, with its usage (after `storytree `) when its inputs cannot spell it, as grouped flags. */
  readonly command: { readonly family: string; readonly name: string; readonly summary: string; readonly usage?: string } | Absent;
  readonly tool: { readonly name: string; readonly description: string } | Absent;
  readonly inputs: I;
  /** Only an agent session may call it: why, as "it closes out the agent session that runs it". */
  readonly agentOnly?: string;
  /** Who calls it (ADR-1045 D1): left out, both, or only an agent when it is `agentOnly`. Read it with `consumersOf`. */
  readonly consumers?: readonly Consumer[];
  /** Its work needs no project or library (it reads a file, or runs offline): a door hands it only the place, with the caller's session when it knows one. */
  readonly callerless?: true;
  /** Its work writes to the library: each door hands it the writer (the context's `writer`), and the command line names that writer below its answer. */
  readonly writes?: true;
  act(input: InputOf<I>, context: C, words: DoorWords): Promise<VerbAnswer>;
}

/**
 * A command family: `storytree <name> <verb>` for each of its verbs, and `storytree <name> <inner> <verb>` for each family
 * within it. `bare` runs for `storytree <name> …` when the next word names none of its verbs. `guesses` are words agents
 * try for a job another command does, each with that command (after `storytree `); `retired` are words for a step
 * storytree has retired, each with why and the command for the job now: the command line names them rather than run them.
 */
export interface VerbFamilies<C extends VerbPlace = VerbContext> {
  readonly name: string;
  /** Other names the family answers to, which the families list does not show: a story's old name. */
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly verbs: readonly Verb<VerbInputs, C>[];
  readonly bare?: Verb<VerbInputs, C>;
  readonly families?: readonly VerbFamilies<C>[];
  readonly guesses?: Readonly<Record<string, string>>;
  readonly retired?: Readonly<Record<string, { readonly why: string; readonly instead: string }>>;
}

/**
 * A command family a story declares in its manifest's `verbs` (ADR-1033), listed among `storytree`'s families in
 * ascending `order`, so a family keeps its place in the help as it moves. Places need not be contiguous: any unused
 * number, fractional included, places a new family without moving another.
 */
export interface VerbFamily<C extends VerbPlace = VerbContext> extends VerbFamilies<C> {
  readonly order: number;
}

/** Declare a verb, keeping its inputs' and its context's types for its act. */
export function verb<I extends VerbInputs, C extends VerbPlace = VerbContext>(declared: Verb<I, C>): Verb<VerbInputs, C> {
  return declared as unknown as Verb<VerbInputs, C>;
}

/** Who calls `declared`: its consumers as declared, else an agent alone for an `agentOnly` verb, else both. */
export function consumersOf(declared: Pick<Verb, "agentOnly" | "consumers">): readonly Consumer[] {
  return declared.consumers ?? (declared.agentOnly === undefined ? ["agent", "user"] : ["agent"]);
}

/**
 * Whether the doors' door-answered lines can judge a verb's use: only when an agent session is its one caller, since a
 * person's own terminal and the watcher write no line (ADR-1045 D1, ADR-1280 D1).
 */
export function judgedByLines(consumers: readonly Consumer[]): boolean {
  return consumers.every((consumer) => consumer === "agent");
}

/** Whether a door mounts the verb: a face that is not `Absent`. */
export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}

/**
 * Where a write goes (ADR-1348 D3): every verb or tool that writes a library takes these, at least one, so the library it
 * lands in is named, never read from the folder. A door adds each one a write does not declare itself; a write's own
 * `arc` or `increment` input names its place as well.
 */
export const WHERE_INPUTS = {
  project: { kind: "text", optional: true, describe: "The project this write is about, whose library it lands in: this folder's own, its factory, or a project that factory builds. Name it, the arc or the increment: at least one" },
  arc: { kind: "text", optional: true, describe: "The arc this write is about: it lands in the library holding that arc" },
  increment: { kind: "text", optional: true, describe: "The increment this write is about: it lands in the library holding that increment" },
} as const satisfies VerbInputs;

/** The place a write names: a project, an arc, an increment, or several. */
export interface WhereNamed {
  readonly project?: string | undefined;
  readonly arc?: string | undefined;
  readonly increment?: string | undefined;
}

/** The place `given` names: its project, arc and increment, each only when it is text that is not blank. */
export function whereOf(given: Readonly<Record<string, unknown>>): WhereNamed {
  const named = (value: unknown): string | undefined => typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  return { project: named(given.project), arc: named(given.arc), increment: named(given.increment) };
}

/**
 * The library a write naming `named` lands in, read from `library`, the folder's own (ADR-1348 D3): the library of the
 * project it names, which must be this one, its factory or a project that factory builds, and the library holding the
 * arc or increment it names, looked for in that project's alone when one is named, else in this one's and then in the
 * rest of its factory's circle, where a member whose database is dropped while it is searched holds nothing. A write
 * naming none is refused as a misuse, saying what to pass; so is a project outside the circle, an arc or increment no
 * library this folder reads holds, and one another project holds than the one named or the one its arc or increment is
 * in. Any other failure reading a member of the circle is no refusal: it is thrown as it is.
 */
export async function writtenLibrary(library: Library, named: WhereNamed): Promise<Library> {
  const { project, arc, increment } = named;
  if (project === undefined && arc === undefined && increment === undefined) {
    throw new VerbRefusal(`A write names where it goes (ADR-1348 D3): give project, the project it is about (this folder's is "${library.name}"), or the arc or the increment it is on.`, { misuse: true });
  }
  let target = project === undefined ? undefined : await projectLibrary(library, project);
  for (const [kind, id] of [["arc", arc], ["increment", increment]] as const) {
    if (id === undefined) continue;
    target = await holding(library, target, kind, id);
  }
  return target!;
}

/** The library of `project`, read from `library`: its own, or one of its factory's circle; anything else is refused. */
async function projectLibrary(library: Library, project: string): Promise<Library> {
  if (project === library.name) return library;
  try {
    return await library.reach(project);
  } catch (error) {
    if (error instanceof Error && (error.name === "OutsideCircleError" || error.name === "ProjectGoneError")) {
      throw new VerbRefusal(`${error.message} A write names this folder's project ("${library.name}"), its factory or a project that factory builds.`, { misuse: true });
    }
    throw error;
  }
}

/**
 * The library holding the `kind` called `id`: `within` when a project or another place is already named, which must
 * hold it, else this folder's own or, failing that, the first of its factory's circle that does. A member of the circle
 * whose database is gone (SQLSTATE 3D000) holds nothing, and so does one whose connection a forced drop ends (57P01) when
 * reading it once more finds its database gone; any other failure reading a member is no refusal, and is thrown as it is.
 */
async function holding(library: Library, within: Library | undefined, kind: "arc" | "increment", id: string): Promise<Library> {
  const holds = async (each: Library): Promise<boolean> => (await each.get(id))?.type === kind;
  if (within !== undefined) {
    if (await holds(within)) return within;
    throw new VerbRefusal(`Project "${within.name}" holds no ${kind} ${id}: name the project, arc and increment of one place.`, { misuse: true });
  }
  if (await holds(library)) return library;
  const memberHolds = async (each: Library): Promise<boolean> => {
    try {
      return await holds(each);
    } catch (error) {
      if (sqlState(error) === "3D000") return false;
      if (sqlState(error) !== "57P01") throw error;
    }
    try {
      return await holds(each);
    } catch (error) {
      if (sqlState(error) === "3D000") return false;
      throw error;
    }
  };
  for (const each of await library.reachAll()) if (each.opened !== undefined && (await memberHolds(each.opened))) return each.opened;
  throw new VerbRefusal(`No library this folder reads holds ${kind} ${id}: check its id, or name the project it is about instead.`, { misuse: true });
}
