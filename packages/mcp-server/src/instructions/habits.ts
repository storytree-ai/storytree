/**
 * Capability 7 · Instructions, the habits card (the MCP server story, ADR-0969 D1): one short text, a
 * screen or less, that teaches the agent storytree's habits. The tool server hands it to the agent at
 * the start of every session, as its instructions, which Claude Code reads. Codex never shows a tool
 * server's instructions: its sessions get a short section in Codex's AGENTS.md instead, which the
 * app setup writes when it connects Codex. The starter roles are named by check_setup, not here:
 * both harnesses' first sessions opened them from that alone (increment_a3786e385e28).
 *
 * Each story's package declares its own section in its manifest (the guidance kind, ADR-1021), and the card is
 * composed from the packages the server mounts, in their manifests' order (contract 7.10). Only the opening, the
 * setup check's paragraph and the closing are the server's own: what storytree is, how a session starts and what to
 * do when it is not running speak of storytree as a whole, and belong to no one story.
 *
 * A part this computer switches off (ADR-1095) takes its section with it, and the card names it switched off instead.
 *
 * The card names each tool in backticks, and uses backticks for nothing else: its tests hold it to
 * naming exactly the tools the server has, within its word budget.
 */
import { CONTRACT_DEFINITION } from "@storytree/library";
import { mount } from "@storytree/plugin-loader";
import GUIDANCE from "#parts/guidance";

/** What one contract is (contract 7.8): the library owns the definition, and plan_contract quotes it when a title runs long (6.57). */
export { CONTRACT_DEFINITION };

/**
 * The card's budget (ADR-1113 D1): the words of the whole card, so a short section costs what it says. It replaces
 * a 60-line limit that charged every section two lines whatever its length.
 */
export const CARD_WORD_BUDGET = 2_500;

/** How many words `card` has, as the budget counts them: runs of non-space text. */
export function cardWords(card: string): number {
  return card.split(/\s+/).filter(Boolean).length;
}

const OPENING = "storytree keeps this project's plan and records what you do, so the user can watch it grow.";

/**
 * The setup check and making a project are the server's own tools, served in any folder whatever is switched off
 * (ADR-1099 D2), so the card teaches them itself: check_setup's answer is where the whole card reaches an agent.
 */
const SETUP = "Start every session with `check_setup`, and do what it says. If this folder isn't a storytree project, carry on without storytree: never offer to set it up. Call `set_up_project` only when the user asks for storytree here, with a name no project has (a refusal suggests one); set its join only to add this computer's copy of a project they have elsewhere.";

const CLOSING = "If storytree says it isn't running, carry on without it.";

/** The habits card, as the tool server hands it to the agent, without the sections of the parts `off` switches off. */
export function habitsCard(off: readonly string[] = []): string {
  const { mounted, off: switched } = mount(GUIDANCE, off);
  const said = switched.length === 0 ? [] : [`Switched off on this computer, so not served here: ${switched.map(({ part }) => part).join(", ")}. The user switches one on with: storytree settings set part <part> on`];
  return [`${OPENING} ${SETUP}`, ...mounted, ...said, CLOSING].join("\n\n");
}
