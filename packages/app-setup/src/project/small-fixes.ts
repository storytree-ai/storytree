// Capability 6 · Make a folder a project.
import type { Library } from "@storytree/library";

export const SMALL_FIXES_ARC = "small-fixes";

const STORYTREES_OWN = "storytree";

const ARC = {
  title: "Small fixes",
  intent: "The one home for this project's small fixes: each is one increment with a one-line objective, for a change that adds or changes no contract. It plans no new story, capability or contract, though it may name an existing contract it restores.",
  endState: "Standing: this arc never closes and keeps taking small fixes. Anything bigger, a change that adds or changes a contract, goes on a real arc of its own, planned there.",
};

export async function smallFixesArc(library: Pick<Library, "name" | "get" | "createArc">): Promise<{ id: string; made: boolean } | undefined> {
  if (library.name === STORYTREES_OWN) return undefined;
  if ((await library.get(SMALL_FIXES_ARC)) !== null) return { id: SMALL_FIXES_ARC, made: false };
  try {
    await library.createArc(ARC, { id: SMALL_FIXES_ARC, onlyIfNew: true });
    return { id: SMALL_FIXES_ARC, made: true };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return (await library.get(SMALL_FIXES_ARC)) === null ? undefined : { id: SMALL_FIXES_ARC, made: false };
  }
}

export function smallFixesSentence(id: string): string {
  return `Park a small fix, one that adds or changes no contract, as one increment with a one-line objective on this project's standing small-fixes arc "${id}"; anything bigger goes on an arc of its own.`;
}
