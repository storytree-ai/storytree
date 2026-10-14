/**
 * Capability 4 · The verb contract (ADR-0969 D2, ADR-1025): a verb is declared once, by the story that owns its work, and
 * both front doors mount it: the command line (`storytree <family> <verb>`) and the MCP server (a tool). A
 * declaration is its name on each door (or why a door does not mount it), one description of its inputs, one
 * piece of work done for the calling session, and one answer: a sentence, data, and next steps each door words
 * in its own terms. It lives in the core because every verb acts for a calling session (ADR-1025 D2); what else a
 * verb's work needs, such as Session management's activity log, its declaring story adds to the context it types.
 *
 * Nothing here loads anything: a door's menus read declarations at start, and the work a verb does is imported
 * inside its act.
 */
import type { Library, Storytree, WriteOptions } from "@storytree/library";

/**
 * One input. `text` is a non-empty string, a command's word at `word` when given, else its `--flag <value>`, and
 * left out it reads as nothing when `optional`; with `many`, it is every such string, each word from `word` on or each
 * `--flag` given, and left out it reads as none when `optional`. `yes-no` is a boolean, a command's `--flag yes|no`;
 * `switch` is a boolean that is false unless given, a command's bare `--flag`. `fields` is an open set: each of a
 * command's `--<field> <value>` its other inputs do not name, by field, its values as given.
 */
export type VerbInput =
  | { readonly kind: "text"; readonly describe: string; readonly word?: number; readonly optional?: true; readonly many?: true }
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
 * Who called, and where: the calling session and its project's library. A story whose verbs need more (Session
 * management's need its activity log) extends this, and the doors that mount those verbs hand it.
 */
export interface VerbContext {
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder: string;
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

/** The verb's own "no": `misuse` when the inputs were wrong, so the command line shows its usage. */
export class VerbRefusal extends Error {
  readonly misuse: boolean;

  constructor(message: string, options: { misuse?: boolean } = {}) {
    super(message);
    this.name = "VerbRefusal";
    this.misuse = options.misuse ?? false;
  }
}

/** A door that does not mount a verb says why, so a missing tool or command is declared, never an accident. */
export interface Absent {
  readonly absent: string;
}

export interface Verb<I extends VerbInputs = VerbInputs, C extends VerbContext = VerbContext> {
  /** `storytree <family> <name>`, with its usage (after `storytree `) when its inputs cannot spell it, as grouped flags. */
  readonly command: { readonly family: string; readonly name: string; readonly summary: string; readonly usage?: string } | Absent;
  readonly tool: { readonly name: string; readonly description: string } | Absent;
  readonly inputs: I;
  /** Only an agent session may call it: why, as "it closes out the agent session that runs it". */
  readonly agentOnly?: string;
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
export interface VerbFamilies<C extends VerbContext = VerbContext> {
  readonly name: string;
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
export interface VerbFamily<C extends VerbContext = VerbContext> extends VerbFamilies<C> {
  readonly order: number;
}

/** Declare a verb, keeping its inputs' and its context's types for its act. */
export function verb<I extends VerbInputs, C extends VerbContext = VerbContext>(declared: Verb<I, C>): Verb<VerbInputs, C> {
  return declared as unknown as Verb<VerbInputs, C>;
}

export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}

/** A command's usage, after `storytree `, from the verb's inputs: `session close-out --safe yes|no --why <why>`. */
export function commandUsage(declared: Verb<VerbInputs, never>): string {
  if (!mounted(declared.command)) throw new Error(`${mounted(declared.tool) ? declared.tool.name : "this verb"} has no command: ${declared.command.absent}`);
  if (declared.command.usage !== undefined) return declared.command.usage;
  const entries = Object.entries(declared.inputs);
  const words = entries.flatMap(([name, input]) => input.kind === "text" && input.word !== undefined ? [[input.word, spelt(input, `<${name}>`)] as const] : []).sort(([a], [b]) => a - b).map(([, word]) => word);
  const flags = entries.flatMap(([name, input]) => {
    if (input.kind === "switch") return [`[--${name}]`];
    if (input.kind === "yes-no") return [`--${name} yes|no`];
    if (input.kind === "fields") return ["--<field> <value> …"];
    return input.word !== undefined ? [] : [spelt(input, `--${name} <${name}>`)];
  });
  return [declared.command.family, declared.command.name, ...words, ...flags].join(" ");
}

/** A text input's place in a usage: `[…]` when it may be left out, `…` after it when it may come again. */
function spelt(input: VerbInput & { kind: "text" }, place: string): string {
  const many = input.many ? `${place} …` : place;
  return input.optional ? `[${many}]` : many;
}

/** A command's words and flags, as `commandInput` reads them. */
export interface CommandGiven {
  word(index: number): string | undefined;
  /** The flag's value, the last given. */
  flag(name: string): string | undefined;
  /** Every value given for the flag, in order. */
  flags(name: string): readonly string[];
  has(name: string): boolean;
  /** The flags given, by name. */
  names(): readonly string[];
}

/** A command's words and flags read as the verb's input, or a refusal saying what is wrong. */
export function commandInput(declared: Verb<VerbInputs, never>, given: CommandGiven): InputOf<VerbInputs> {
  const input: Record<string, VerbValue> = {};
  for (const [name, one] of Object.entries(declared.inputs)) {
    if (one.kind === "fields") {
      const named = new Set(Object.keys(declared.inputs));
      input[name] = Object.fromEntries(given.names().filter((field) => !named.has(field)).map((field) => [field, given.flag(field)!]));
    } else if (one.kind === "text" && one.many) {
      const values = one.word === undefined ? given.flags(name) : wordsFrom(given, one.word);
      if (values.length === 0 && !one.optional) throw new VerbRefusal(`this needs ${one.word === undefined ? `--${name}` : `<${name}>`}: ${one.describe}`, { misuse: true });
      input[name] = values.map((value) => said(name, one, value));
    } else if (one.kind === "switch") {
      input[name] = given.has(name);
    } else if (one.kind === "yes-no") {
      const value = given.flag(name);
      if (value === undefined) throw new VerbRefusal(`this needs --${name} yes|no`, { misuse: true });
      if (value !== "yes" && value !== "no") throw new VerbRefusal(`--${name} is yes or no, not ${JSON.stringify(value)}`, { misuse: true });
      input[name] = value === "yes";
    } else {
      const value = one.word === undefined ? given.flag(name) : given.word(one.word);
      if (value === undefined && one.optional) input[name] = undefined;
      else if (value === undefined) throw new VerbRefusal(`this needs ${one.word === undefined ? `--${name}` : `<${name}>`}: ${one.describe}`, { misuse: true });
      else input[name] = said(name, one, value);
    }
  }
  return input;
}

/** Each word from `index` on. */
function wordsFrom(given: CommandGiven, index: number): string[] {
  const words: string[] = [];
  for (let at = index; given.word(at) !== undefined; at++) words.push(given.word(at)!);
  return words;
}

/**
 * A tool's arguments, as its schema checked them, read as the verb's input: a switch not given is false, a `many`
 * input is a list, and `fields` an object of strings.
 */
export function toolInput(declared: Verb<VerbInputs, never>, args: Readonly<Record<string, unknown>>): InputOf<VerbInputs> {
  const input: Record<string, VerbValue> = {};
  for (const [name, one] of Object.entries(declared.inputs)) {
    const value = args[name];
    if (one.kind === "fields") input[name] = Object.fromEntries(Object.entries((value ?? {}) as Record<string, unknown>).map(([field, given]) => [field, String(given)]));
    else if (one.kind !== "text") input[name] = value === true;
    else if (one.many) {
      const values = value === undefined ? [] : (value as readonly unknown[]).map(String);
      if (values.length === 0 && !one.optional) throw new VerbRefusal(`this needs ${name}: ${one.describe}`, { misuse: true });
      input[name] = values.map((given) => said(name, one, given));
    } else input[name] = value === undefined && one.optional ? undefined : said(name, one, String(value));
  }
  return input;
}

/** A text input, trimmed: one that says nothing is refused on either door. */
function said(name: string, input: VerbInput, value: string): string {
  const text = value.trim();
  if (text === "") throw new VerbRefusal(`${name} is empty: ${input.describe}`, { misuse: true });
  return text;
}
