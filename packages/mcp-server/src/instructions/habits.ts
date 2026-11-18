// Capability 7 · Instructions (the habits card)
import { CONTRACT_DEFINITION } from "@storytree/library";
import { mount, standIn, type StandIns } from "@storytree/plugin-loader";
import { CONCEPTS } from "@storytree/shown-words";
import GUIDANCE from "#parts/guidance";

export { CONTRACT_DEFINITION };

export const CARD_WORD_BUDGET = 2_500;

export function cardWords(card: string): number {
  return card.split(/\s+/).filter(Boolean).length;
}

const OPENING = "storytree keeps this project's plan and records what you do, so the user can watch it grow.";

const SETUP = "Start every session with `check_setup`, and do what it says. If this folder isn't a storytree project, carry on without storytree: never offer to set it up. Call `set_up_project` only when the user asks for storytree here, with a name no project has (a refusal suggests one); set its join only to add this computer's copy of a project they have elsewhere.";

const WORDS = `The tools name things in the library's words; to the user, say ${(["capability", "arc", "increment"] as const).map((concept) => `"${CONCEPTS[concept].one}" for ${concept}`).join(", ")}.`;

const PLACE = "A tool that writes the library names where the write goes: give project (this folder's own, its factory, or a project that factory builds), or the arc or increment the write is about; a write naming none is refused.";

const CLOSING = "If storytree says it isn't running, carry on without it.";

export function habitsCard(off: readonly string[] = [], standIns: StandIns = { plugins: {} }): string {
  const composed = standIn(GUIDANCE, "guidance", standIns);
  const { mounted, off: switched } = mount(composed, off);
  const servedBy = new Set(Object.values(composed.standsIn ?? {}));
  const unserved = switched.filter(({ part }) => !servedBy.has(part));
  const said = unserved.length === 0 ? [] : [`Switched off on this computer, so not served here: ${unserved.map(({ part }) => part).join(", ")}. The user switches one on with: storytree settings set module <module> on`];
  return [`${OPENING} ${SETUP}`, ...mounted, `${WORDS} ${PLACE}`, ...said, CLOSING].join("\n\n");
}
