/**
 * Capability 16 · The command schema (ADR-1035 D1, ADR-0969 D2): the shapes a verb is declared with, once, by the story
 * that owns its work, which both front doors mount: the command line (`storytree <family> <verb>`) and the MCP server (a
 * tool). A declaration is its name on each door (or why a door does not mount it), one description of its inputs, one
 * piece of work done for the calling session, and one answer: a sentence, data, and next steps each door words in its
 * own terms. The library holds the schema so every story downstream, the library's own included, imports it; reading a
 * door's words into a verb's input is each door's own code (ADR-1035 D2). What else a verb's work needs, such as
 * Session management's activity log, its declaring story adds to the context it types.
 *
 * Nothing here loads anything: a door's menus read declarations at start, and the work a verb does is imported
 * inside its act.
 */
import type { Library, Storytree } from "../api/index.js";
import type { WriteOptions } from "../schema/index.js";

/**
 * One input. `text` is a non-empty string, a command's word at `word` when given, else its `--flag <value>`, and
 * left out it reads as nothing when `optional`, and given as only whitespace it is refused unless `blank`, which reads it as
 * empty; with `many`, it is every such string, each word from `word` on or each
 * `--flag` given, and left out it reads as none when `optional`. `yes-no` is a boolean, a command's `--flag yes|no`;
 * `switch` is a boolean that is false unless given, a command's bare `--flag`. `fields` is an open set: each of a
 * command's `--<field> <value>` its other inputs do not name, by field, its values as given.
 */
export type VerbInput =
  | { readonly kind: "text"; readonly describe: string; readonly word?: number; readonly optional?: true; readonly many?: true; readonly blank?: true }
  | { readonly kind: "yes-no"; readonly describe: string }
  | { readonly kind: "switch"; readonly describe: string }
  | { readonly kind: "fields"; readonly describe: string };

export type VerbInputs = Readonly<Record<string, VerbInput>>;

/** What the inputs come to when the work runs. */
export type InputOf<I extends VerbInputs> = { readonly [K in keyof I]:
  I[K] extends { kind: "text"; many: true } ? readonly string[]
  : I[K] extends { kind: "text"; optional: true } ? string | undefined
  : I[K] extends { kind: "text" } ? string
  : I[K] extends { kind: "yes-no" | "switch" } ? boolean
  : I[K] extends { kind: "fields" } ? Readonly<Record<string, string>>
  : VerbValue };

/** Any one input's value. */
export type VerbValue = string | boolean | undefined | readonly string[] | Readonly<Record<string, string>>;

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

/** A door that does not mount a verb says why, so a missing tool or command is declared, never an accident. */
export interface Absent {
  readonly absent: string;
}

export interface Verb<I extends VerbInputs = VerbInputs, C extends VerbPlace = VerbContext> {
  /** `storytree <family> <name>`, with its usage (after `storytree `) when its inputs cannot spell it, as grouped flags. */
  readonly command: { readonly family: string; readonly name: string; readonly summary: string; readonly usage?: string } | Absent;
  readonly tool: { readonly name: string; readonly description: string } | Absent;
  readonly inputs: I;
  /** Only an agent session may call it: why, as "it closes out the agent session that runs it". */
  readonly agentOnly?: string;
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
 * A command family a story declares in its manifest's `verbs` (ADR-1033), listed `order`th among `storytree`'s
 * families, counted from 1, so a family keeps its place in the help as it moves.
 */
export interface VerbFamily<C extends VerbPlace = VerbContext> extends VerbFamilies<C> {
  readonly order: number;
}

/** Declare a verb, keeping its inputs' and its context's types for its act. */
export function verb<I extends VerbInputs, C extends VerbPlace = VerbContext>(declared: Verb<I, C>): Verb<VerbInputs, C> {
  return declared as unknown as Verb<VerbInputs, C>;
}

/** Whether a door mounts the verb: a face that is not `Absent`. */
export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}
