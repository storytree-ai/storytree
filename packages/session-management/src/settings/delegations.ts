/** Capability 10 · Settings: the project's standing delegations, which the app shows beside who decides what (10.14). */
import type { Library } from "@storytree/library";

/** The term of the definition a project keeps its owner's standing delegations under. */
export const STANDING_DELEGATION = "Standing delegation";

/**
 * The project's standing delegations (ADR-0842 D4): the kinds of decision its owner has already
 * handed to agents, as the meaning of the definition "Standing delegation", or none when its
 * library does not define one. What the card tells agents to check before asking.
 */
export async function standingDelegations(library: Pick<Library, "definitions">): Promise<string | undefined> {
  return (await library.definitions()).find(({ fields }) => fields.term === STANDING_DELEGATION)?.fields.meaning;
}
