// Capability 6 · Make a folder a project.
import type { Library, Storytree } from "@storytree/library";

import { FACTORY_NAME, userFactory } from "./making.js";
import { PACK_ACTOR, PACK_KINDS, type StarterPackRecord } from "./starter-pack.js";

const ACTOR = "storytree setup (move onto the factory)";

export interface MoveOptions {
  readonly storytree: Storytree;
  readonly project: string;
  readonly factory?: string;
}

export interface Moved {
  readonly factory: string;
  readonly dropped: StarterPackRecord[];
  readonly kept: (StarterPackRecord & { readonly why: "own" | "not in the factory" })[];
}

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

async function systemTitles(storytree: Storytree, name: string): Promise<Set<string>> {
  const library: Library = await storytree.openProject(name, { create: false });
  try {
    const titles = await Promise.all(PACK_KINDS.map(async (kind) => (await library.list(kind)).map((record) => `${kind}\0${record.fields.title}`)));
    return new Set(titles.flat());
  } finally {
    await library.close();
  }
}
