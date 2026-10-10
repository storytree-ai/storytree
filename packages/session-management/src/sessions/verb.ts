/**
 * Capability 4 · Sessions. The verb contract (ADR-0969 D2): a verb is declared once, by the story that owns its work, and
 * both front doors mount it: the command line (`storytree <family> <verb>`) and the MCP server (a tool). A
 * declaration is its name on each door (or why a door does not mount it), one description of its inputs, one
 * piece of work done for the calling session, and one answer: a sentence, data, and next steps each door words
 * in its own terms. It lives here because every verb acts for a calling session and writes to its log.
 *
 * Nothing here loads anything: a door's menus read declarations at start, and the work a verb does is imported
 * inside its act.
 */
import type { Library, WriteOptions } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";

/**
 * One input. `text` is a non-empty string, a command's word at `word` when given, else its `--flag <value>`;
 * `yes-no` is a boolean, a command's `--flag yes|no`; `switch` is a boolean that is false unless given, a
 * command's bare `--flag`.
 */
export type VerbInput =
  | { readonly kind: "text"; readonly describe: string; readonly word?: number }
  | { readonly kind: "yes-no"; readonly describe: string }
  | { readonly kind: "switch"; readonly describe: string };

export type VerbInputs = Readonly<Record<string, VerbInput>>;

/** What the inputs come to when the work runs. */
export type InputOf<I extends VerbInputs> = { readonly [K in keyof I]: I[K] extends { kind: "text" } ? string : I[K] extends { kind: "yes-no" | "switch" } ? boolean : string | boolean };

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

/** Who called, and where: the calling session, its log and its project's library. */
export interface VerbContext {
  readonly log: ActivityLog;
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly folder: string;
  readonly branch?: string;
  readonly writer?: WriteOptions;
  /** The storytree home the caller's process ledger and claims are kept under, when not the usual one. */
  readonly home?: string;
}

/** A verb's answer: one sentence (or a few lines), what it made or found, and the steps that open what it named. */
export interface VerbAnswer {
  readonly text: string;
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

export interface Verb<I extends VerbInputs = VerbInputs> {
  /** `storytree <family> <name>`. */
  readonly command: { readonly family: string; readonly name: string; readonly summary: string } | Absent;
  readonly tool: { readonly name: string; readonly description: string } | Absent;
  readonly inputs: I;
  /** Only an agent session may call it: why, as "it closes out the agent session that runs it". */
  readonly agentOnly?: string;
  act(input: InputOf<I>, context: VerbContext, words: DoorWords): Promise<VerbAnswer>;
}

/** Declare a verb, keeping its inputs' types for its act. */
export function verb<I extends VerbInputs>(declared: Verb<I>): Verb {
  return declared as unknown as Verb;
}

export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}

/** A command's usage, after `storytree `, from the verb's inputs: `session close-out --safe yes|no --why <why>`. */
export function commandUsage(declared: Verb): string {
  if (!mounted(declared.command)) throw new Error(`${mounted(declared.tool) ? declared.tool.name : "this verb"} has no command: ${declared.command.absent}`);
  const entries = Object.entries(declared.inputs);
  const words = entries.flatMap(([name, input]) => input.kind === "text" && input.word !== undefined ? [[input.word, `<${name}>`] as const] : []).sort(([a], [b]) => a - b).map(([, word]) => word);
  const flags = entries.flatMap(([name, input]) => input.kind === "switch" ? [`[--${name}]`] : input.kind === "yes-no" ? [`--${name} yes|no`] : input.word === undefined ? [`--${name} <${name}>`] : []);
  return [declared.command.family, declared.command.name, ...words, ...flags].join(" ");
}

/** A command's words and flags read as the verb's input, or a refusal saying what is wrong. */
export function commandInput(declared: Verb, given: { word(index: number): string | undefined; flag(name: string): string | undefined; has(name: string): boolean }): InputOf<VerbInputs> {
  const input: Record<string, string | boolean> = {};
  for (const [name, one] of Object.entries(declared.inputs)) {
    if (one.kind === "switch") {
      input[name] = given.has(name);
    } else if (one.kind === "yes-no") {
      const value = given.flag(name);
      if (value === undefined) throw new VerbRefusal(`this needs --${name} yes|no`, { misuse: true });
      if (value !== "yes" && value !== "no") throw new VerbRefusal(`--${name} is yes or no, not ${JSON.stringify(value)}`, { misuse: true });
      input[name] = value === "yes";
    } else {
      const value = one.word === undefined ? given.flag(name) : given.word(one.word);
      if (value === undefined) throw new VerbRefusal(`this needs ${one.word === undefined ? `--${name}` : `<${name}>`}: ${one.describe}`, { misuse: true });
      input[name] = said(name, one, value);
    }
  }
  return input;
}

/** A tool's arguments, as its schema checked them, read as the verb's input: a switch not given is false. */
export function toolInput(declared: Verb, args: Readonly<Record<string, unknown>>): InputOf<VerbInputs> {
  const input: Record<string, string | boolean> = {};
  for (const [name, one] of Object.entries(declared.inputs)) input[name] = one.kind === "switch" ? args[name] === true : one.kind === "text" ? said(name, one, String(args[name])) : args[name] === true;
  return input;
}

/** A text input, trimmed: one that says nothing is refused on either door. */
function said(name: string, input: VerbInput, value: string): string {
  const text = value.trim();
  if (text === "") throw new VerbRefusal(`${name} is empty: ${input.describe}`, { misuse: true });
  return text;
}
