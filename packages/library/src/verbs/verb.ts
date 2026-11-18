// Capability 16 · The command schema
import type { Library, Storytree } from "../index.js";
import type { WriteOptions } from "../schema/index.js";
import { sqlState } from "../project/connection-error.js";

export type VerbInput =
  | { readonly kind: "text"; readonly describe: string; readonly word?: number; readonly optional?: true; readonly many?: true; readonly blank?: true; readonly verbatim?: true }
  | { readonly kind: "yes-no"; readonly describe: string }
  | { readonly kind: "switch"; readonly describe: string }
  | { readonly kind: "count"; readonly describe: string; readonly optional?: true }
  | { readonly kind: "fields"; readonly describe: string; readonly json?: true };

export type VerbInputs = Readonly<Record<string, VerbInput>>;

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

export type VerbValue = string | number | boolean | undefined | readonly string[] | Readonly<Record<string, unknown>>;

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

export interface VerbAnswer {
  readonly text: string;
  readonly raw?: true;
  readonly data?: Record<string, unknown>;
  readonly next?: readonly (Step & { readonly why: string })[];
}

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
  return declared.consumers ?? (declared.agentOnly === undefined ? ["agent", "user"] : ["agent"]);
}

export function judgedByLines(consumers: readonly Consumer[]): boolean {
  return consumers.every((consumer) => consumer === "agent");
}

export function mounted<T extends object>(face: T | Absent): face is T {
  return !("absent" in face);
}

export const WHERE_INPUTS = {
  project: { kind: "text", optional: true, describe: "The project this write is about, whose library it lands in: this folder's own, its factory, or a project that factory builds. Name it, the arc or the increment: at least one" },
  arc: { kind: "text", optional: true, describe: "The arc this write is about: it lands in the library holding that arc" },
  increment: { kind: "text", optional: true, describe: "The increment this write is about: it lands in the library holding that increment" },
} as const satisfies VerbInputs;

export interface WhereNamed {
  readonly project?: string | undefined;
  readonly arc?: string | undefined;
  readonly increment?: string | undefined;
}

export function whereOf(given: Readonly<Record<string, unknown>>): WhereNamed {
  const named = (value: unknown): string | undefined => typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  return { project: named(given.project), arc: named(given.arc), increment: named(given.increment) };
}

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
