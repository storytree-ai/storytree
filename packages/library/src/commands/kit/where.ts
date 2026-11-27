// Capability 16 · The command schema
import type { Library } from "../../index.js";
import { VerbRefusal } from "./verb.js";

export const WHERE_INPUTS = {
  project: {
    kind: "text",
    optional: true,
    describe: "The project this write is about, whose library it lands in: this folder's own, its factory, or a project that factory builds. Name it, the arc or the increment: at least one",
  },
  arc: { kind: "text", optional: true, describe: "The arc this write is about: it lands in the library holding that arc" },
  increment: { kind: "text", optional: true, describe: "The increment this write is about: it lands in the library holding that increment" },
} as const;

export interface WhereNamed {
  readonly project?: string | undefined;
  readonly arc?: string | undefined;
  readonly increment?: string | undefined;
}

type Held = readonly ["arc" | "increment", string];

const OUTSIDE: readonly string[] = ["OutsideCircleError", "ProjectGoneError"];

function named(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

export function whereOf(given: Readonly<Record<string, unknown>>): WhereNamed {
  return { project: named(given["project"]), arc: named(given["arc"]), increment: named(given["increment"]) };
}

export function outsideCircle(error: unknown): error is Error {
  return error instanceof Error && OUTSIDE.includes(error.name);
}

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

async function holds(library: Library, [kind, id]: Held): Promise<boolean> {
  return (await library.get(id))?.type === kind;
}

async function memberHolds(library: Library, held: Held): Promise<boolean> {
  try {
    return await holds(library, held);
  } catch (error) {
    if (codeOf(error) === "3D000") return false;
    if (codeOf(error) !== "57P01") throw error;
  }
  try {
    return await holds(library, held);
  } catch (error) {
    if (codeOf(error) === "3D000") return false;
    throw error;
  }
}

async function projectLibrary(library: Library, project: string): Promise<Library> {
  if (project === library.name) return library;
  try {
    return await library.reach(project);
  } catch (error) {
    if (!outsideCircle(error)) throw error;
    const more = error.name === "OutsideCircleError" ? ` A write names this folder's project (${JSON.stringify(library.name)}), its factory or a project that factory builds.` : "";
    throw new VerbRefusal(`${error.message}${more}`, { misuse: true });
  }
}

async function holding(library: Library, held: Held): Promise<Library> {
  if (await holds(library, held)) return library;
  for (const reached of await library.reachAll()) {
    if (reached.opened === undefined || reached.project === library.name) continue;
    if (await memberHolds(reached.opened, held)) return reached.opened;
  }
  throw new VerbRefusal(`No library this folder reads holds ${held[0]} ${held[1]}: name the project it is in with project, or check the id.`, { misuse: true });
}

export async function writtenLibrary(library: Library, given: WhereNamed): Promise<Library> {
  const { project, arc, increment } = whereOf({ ...given });
  const held: Held[] = [...(arc === undefined ? [] : [["arc", arc] as const]), ...(increment === undefined ? [] : [["increment", increment] as const])];
  if (project === undefined && held.length === 0) {
    throw new VerbRefusal(`A write names where it goes: give project (this folder's is ${JSON.stringify(library.name)}), or the arc or the increment it is about.`, { misuse: true });
  }
  const there = project === undefined ? await holding(library, held[0]!) : await projectLibrary(library, project);
  for (const one of held) {
    if (!(await holds(there, one))) throw new VerbRefusal(`Project ${JSON.stringify(there.name)} holds no ${one[0]} ${one[1]}: name the project that does, or leave project out to find it.`, { misuse: true });
  }
  return there;
}
