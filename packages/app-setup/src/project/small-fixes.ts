/**
 * Capability 6 · Make a folder a project: a user project's one standing small-fixes arc (ADR-1266 D2, D3, contract 6.15).
 * storytree makes it, never the agent: when a folder is set up, and once for a project set up before it, when its agent
 * first checks the setup. It sits at one fixed id, so an agent names it without searching, and a record ever written under
 * that id, retired or not, means it is never made again. storytree's own project gets none: ADR-0792 still governs its
 * friction fixes.
 */
import type { Library } from "@storytree/library";

/** The small-fixes arc's id in every user project. */
export const SMALL_FIXES_ARC = "small-fixes";

/** storytree's own project, which parks its small fixes on scoped arcs (ADR-0792). */
const STORYTREES_OWN = "storytree";

const ARC = {
  title: "Small fixes",
  intent: "The one home for this project's small fixes: each is one increment with a one-line objective, for a change that adds or changes no contract. It plans no new story, capability or contract, though it may name an existing contract it restores.",
  endState: "Standing: this arc never closes and keeps taking small fixes. Anything bigger, a change that adds or changes a contract, goes on a real arc of its own, planned there.",
};

/**
 * Project `library`'s small-fixes arc, made now when it never had one (`made`), or undefined for storytree's own project
 * and for a project whose arc was retired. Of calls racing to make it, only one does.
 */
export async function smallFixesArc(library: Pick<Library, "name" | "get" | "createArc">): Promise<{ id: string; made: boolean } | undefined> {
  if (library.name === STORYTREES_OWN) return undefined;
  if ((await library.get(SMALL_FIXES_ARC)) !== null) return { id: SMALL_FIXES_ARC, made: false };
  try {
    await library.createArc(ARC, { id: SMALL_FIXES_ARC, onlyIfNew: true });
    return { id: SMALL_FIXES_ARC, made: true };
  } catch (error) {
    // Its id was written before: by a call racing this one, or for an arc since retired, which stays retired.
    if (!(error instanceof RangeError)) throw error;
    return (await library.get(SMALL_FIXES_ARC)) === null ? undefined : { id: SMALL_FIXES_ARC, made: false };
  }
}

/** What the agent is told of arc `id`: a small fix is parked on it, and anything bigger on an arc of its own. */
export function smallFixesSentence(id: string): string {
  return `Park a small fix, one that adds or changes no contract, as one increment with a one-line objective on this project's standing small-fixes arc "${id}"; anything bigger goes on an arc of its own.`;
}
