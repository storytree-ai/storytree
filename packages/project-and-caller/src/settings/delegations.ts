// Capability 2 · Settings
import type { Library } from "@storytree/library";

export const STANDING_DELEGATION = "Standing delegation";

export async function standingDelegations(library: Pick<Library, "definitions">): Promise<string | undefined> {
  return (await library.definitions()).find(({ fields }) => fields.term === STANDING_DELEGATION)?.fields.meaning;
}
