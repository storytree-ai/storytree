// Capability 28 · Shared library
import { sqlState } from "./connection-error.js";
import { VerbRefusal, type VerbInputs } from "../../verbs/verb.js";

export interface WhereLibrary<L> {
  readonly name: string;
  get(id: string): Promise<{ readonly type: string } | null>;
  reach(project: string): Promise<L>;
  reachAll(): Promise<readonly { readonly opened?: L | undefined }[]>;
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

export async function writtenLibrary<L extends WhereLibrary<L>>(library: L, named: WhereNamed): Promise<L> {
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

async function projectLibrary<L extends WhereLibrary<L>>(library: L, project: string): Promise<L> {
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

async function holding<L extends WhereLibrary<L>>(library: L, within: L | undefined, kind: "arc" | "increment", id: string): Promise<L> {
  const holds = async (each: L): Promise<boolean> => (await each.get(id))?.type === kind;
  if (within !== undefined) {
    if (await holds(within)) return within;
    throw new VerbRefusal(`Project "${within.name}" holds no ${kind} ${id}: name the project, arc and increment of one place.`, { misuse: true });
  }
  if (await holds(library)) return library;
  const memberHolds = async (each: L): Promise<boolean> => {
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
