import type { Library, Storytree } from "../../index.js";
import type { WriteOptions } from "../../storage/rules/index.js";

export type VerbInput =
  | {
    readonly kind: "text";
    readonly describe: string;
    readonly word?: number;
    readonly optional?: true;
    readonly many?: true;
    readonly blank?: true;
    readonly verbatim?: true;
  }
  | { readonly kind: "yes-no"; readonly describe: string }
  | { readonly kind: "switch"; readonly describe: string }
  | { readonly kind: "count"; readonly describe: string; readonly optional?: true }
  | { readonly kind: "fields"; readonly describe: string; readonly json?: true };

export type VerbInputs = Readonly<Record<string, VerbInput>>;

export type InputOf<I extends VerbInputs> = {
  readonly [K in keyof I]: I[K] extends { kind: "text"; many: true } ? readonly string[]
    : I[K] extends { kind: "text"; optional: true } ? string | undefined
      : I[K] extends { kind: "text" } ? string
        : I[K] extends { kind: "yes-no" | "switch" } ? boolean
          : I[K] extends { kind: "count"; optional: true } ? number | undefined
            : I[K] extends { kind: "count" } ? number
              : I[K] extends { kind: "fields"; json: true } ? Readonly<Record<string, unknown>>
                : I[K] extends { kind: "fields" } ? Readonly<Record<string, string>>
                  : VerbValue;
};

export type VerbValue = string | number | boolean | undefined | readonly string[] | Readonly<Record<string, unknown>>;

const JSON_LIKE = /^(?:true|false|null|-?\d+(?:\.\d+)?|\[[^]*\]|\{[^]*\}|"[^]*")$/;

export function fieldValue(text: string): unknown {
  const trimmed = text.trim();
  if (!JSON_LIKE.test(trimmed)) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export interface Step {
  readonly tool?: string;
  readonly command?: string;
}

export interface DoorWords {
  readonly door: "command" | "tool";
  say(step: Step): string;
}

export interface VerbPlace {
  readonly folder: string;
  readonly session?: string;
  readonly harness?: string;
}

export interface VerbContext extends VerbPlace {
  readonly library: Library;
  readonly project: string;
  readonly session: string;
  readonly harness?: string;
  readonly branch?: string;
  readonly writer?: WriteOptions;
  readonly home?: string;
  readonly server?: Pick<Storytree, "ownDatabase">;
}

export type NextStep = Step & { readonly why: string };

export interface VerbAnswer {
  readonly text: string;
  readonly raw?: true;
  readonly data?: Record<string, unknown>;
  readonly next?: readonly NextStep[];
}

export class VerbRefusal extends Error {
  override readonly name = "VerbRefusal";
  readonly misuse: boolean;
  readonly next: readonly NextStep[];

  constructor(message: string, options: { misuse?: boolean; next?: readonly NextStep[] } = {}) {
    super(message);
    this.misuse = options.misuse ?? false;
    this.next = options.next ?? [];
  }
}

export interface Absent {
  readonly absent: string;
  readonly twin?: string;
}

export type Consumer = "agent" | "user" | "watcher";

export interface Verb<I extends VerbInputs = VerbInputs, C extends VerbPlace = VerbContext> {
  readonly command: { readonly family: string; readonly name: string; readonly summary: string; readonly usage?: string } | Absent;
  readonly tool: { readonly name: string; readonly description: string } | Absent;
  readonly inputs: I;
  readonly agentOnly?: string;
  readonly consumers?: readonly Consumer[];
  readonly callerless?: true;
  readonly writes?: true;
  act(input: InputOf<I>, context: C, words: DoorWords): Promise<VerbAnswer>;
}

export interface VerbFamilies<C extends VerbPlace = VerbContext> {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly verbs: readonly Verb<VerbInputs, C>[];
  readonly bare?: Verb<VerbInputs, C>;
  readonly families?: readonly VerbFamilies<C>[];
  readonly guesses?: Readonly<Record<string, string>>;
  readonly retired?: Readonly<Record<string, { readonly why: string; readonly instead: string }>>;
}

export interface VerbFamily<C extends VerbPlace = VerbContext> extends VerbFamilies<C> {
  readonly order: number;
}

export function verb<I extends VerbInputs, C extends VerbPlace = VerbContext>(declared: Verb<I, C>): Verb<VerbInputs, C> {
  return declared as unknown as Verb<VerbInputs, C>;
}

export function consumersOf(declared: Pick<Verb, "agentOnly" | "consumers">): readonly Consumer[] {
  if (declared.consumers !== undefined) return declared.consumers;
  return declared.agentOnly === undefined ? ["agent", "user"] : ["agent"];
}

export function judgedByLines(consumers: readonly Consumer[]): boolean {
  return consumers.length === 1 && consumers[0] === "agent";
}

export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}
