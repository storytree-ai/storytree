/**
 * Capability 7 · Instructions, the habits card (the MCP server story, ADR-0969 D1): one short text, a
 * screen or less, that teaches the agent storytree's habits. The tool server hands it to the agent at
 * the start of every session, as its instructions, which Claude Code reads. Codex never shows a tool
 * server's instructions: its sessions get a short section in Codex's AGENTS.md instead, which the
 * app setup writes when it connects Codex. The starter roles are named by check_setup, not here:
 * both harnesses' first sessions opened them from that alone (increment_a3786e385e28).
 *
 * Each story's package declares its own section in its manifest (the guidance kind, ADR-1021), and the card is
 * composed from the packages the server mounts, in their manifests' order (contract 7.10). Only the opening and the
 * closing are the server's own: what storytree is and what to do when it is not running speak of storytree as a
 * whole, and belong to no one story.
 *
 * The card names each tool in backticks, and uses backticks for nothing else: its tests hold it to
 * naming exactly the tools the server has, within 60 lines.
 */
import { CONTRACT_DEFINITION } from "@storytree/library";
import GUIDANCE from "#parts/guidance";

/** What one contract is (contract 7.8): the library owns the definition, and plan_contract quotes it when a title runs long (6.57). */
export { CONTRACT_DEFINITION };

const OPENING = "storytree keeps the plan of this project and records what you do, so the user can watch it grow. Work with it like this.";

const CLOSING = "If storytree says it isn't running, carry on without it.";

const HABITS_CARD = [OPENING, ...GUIDANCE, CLOSING].join("\n\n");

/** The habits card, as the tool server hands it to the agent. */
export function habitsCard(): string {
  return HABITS_CARD;
}
