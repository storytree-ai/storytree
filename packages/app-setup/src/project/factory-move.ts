/**
 * Capability 6 · Make a folder a project. Moving an existing project onto the user's factory (contract 6.12, ADR-1040):
 * a project set up before factories holds its own copy of the starter pack. Moving it names the user's factory (found,
 * or made as setting a project up makes it) and drops each copy the project never edited whose kind and title the
 * factory holds, so the factory's shows through. Every record the project edited or added stays its own, a local
 * override, as take_starter_pack never overwrites a user's edit (6.9). A dropped copy is retired, kept in the history,
 * and a link to it reads the record of its kind and title (the library's 1.17), so no role or note loses a link.
 */
import type { Library, Storytree } from "@storytree/library";

import { FACTORY_NAME, userFactory } from "./making.js";
import { PACK_ACTOR, PACK_KINDS, type StarterPackRecord } from "./starter-pack.js";

/** Who the history says dropped a copy. */
const ACTOR = "storytree setup (move onto the factory)";

export interface MoveOptions {
  /** A connection to the running storytree's library. */
  readonly storytree: Storytree;
  /** The project to move. */
  readonly project: string;
  /** The name the user's factory is found or made under; by default FACTORY_NAME. A product keeps the factory it names. */
  readonly factory?: string;
}

/** What moving did: the factory the project now names, each copy dropped, and each record kept as the project's own, with why. */
export interface Moved {
  readonly factory: string;
  readonly dropped: StarterPackRecord[];
  readonly kept: (StarterPackRecord & { readonly why: "own" | "not in the factory" })[];
}

/**
 * Move `project` onto the user's factory (6.12). A copy is dropped only when a pack wrote its newest change and the
 * factory holds a record of its kind and title; one the user edited or added is kept as "own", and an unedited one the
 * factory lacks as "not in the factory". Moving again drops nothing more. The factory itself is refused.
 */
export async function moveOntoFactory({ storytree, project, factory = FACTORY_NAME }: MoveOptions): Promise<Moved> {
  const library = await storytree.openProject(project, { create: false });
  try {
    const link = await library.factory();
    if (link.kind === "factory") throw new RangeError(`Project "${project}" is the user's factory, so it moves onto none.`);
    const named = link.kind === "product" ? link.factory : await userFactory(storytree, factory, await storytree.listProjects());
    const theirs = await systemTitles(storytree, named);
    if (link.kind === "none") await library.recordFactory(named);
    const moved: Moved = { factory: named, dropped: [], kept: [] };
    for (const kind of PACK_KINDS) {
      for (const record of await library.list(kind)) {
        const history = await library.history({ id: record.id });
        // A record with no history here is the factory's, read through: the project holds no copy of it.
        if (history.length === 0) continue;
        const held = { kind, title: record.fields.title, id: record.id };
        if (!PACK_ACTOR.test(history.at(-1)?.actor ?? "")) moved.kept.push({ ...held, why: "own" });
        else if (!theirs.has(`${kind}\0${record.fields.title}`)) moved.kept.push({ ...held, why: "not in the factory" });
        else {
          await library.retire(record.id, `the factory "${moved.factory}" holds it, and this project never edited its copy`, { actor: ACTOR });
          moved.dropped.push(held);
        }
      }
    }
    return moved;
  } finally {
    await library.close();
  }
}

/** Each system record factory `name` holds, as its kind and title. */
async function systemTitles(storytree: Storytree, name: string): Promise<Set<string>> {
  const library: Library = await storytree.openProject(name, { create: false });
  try {
    const titles = await Promise.all(PACK_KINDS.map(async (kind) => (await library.list(kind)).map((record) => `${kind}\0${record.fields.title}`)));
    return new Set(titles.flat());
  } finally {
    await library.close();
  }
}
