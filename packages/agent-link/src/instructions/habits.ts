/**
 * Capability 7 · Instructions, the habits card (stories/agent-link.md): one short text, a screen or
 * less, that teaches the agent storytree's habits. The tool server hands it to the agent at the
 * start of every session, as its instructions; Claude Code and Codex both read it from there.
 *
 * The card names each tool in backticks, and uses backticks for nothing else: its tests hold it to
 * naming exactly the tools the server has, within 60 lines.
 */
const HABITS_CARD = `storytree keeps the plan of this project and records what you do, so the user can watch it grow. Work with it like this.

Start every session with \`check_setup\`, and do what it says. If this folder isn't a storytree project yet, it asks you to ask the user; call \`set_up_project\` only after they say yes.

Plan first.
- \`show_plan\` shows the plan: every story, capability and contract with its health, who holds what, and which sessions are about.
- Plan a story (something a user can do) with \`plan_story\`, the parts that make it work with \`plan_capability\`, and each testable promise with \`plan_contract\`. A story or capability starts with its founding decision: what it is for, and the one choice that shapes it. Group stories under an initiative with \`plan_arc\`. Correct any of them with \`edit_plan\`, and \`retire_from_plan\` a capability or contract no longer wanted, with the reason.
- Break an arc's work into increments with \`park_increment\` (the breakdown goes in its body), and \`ready_increment\` one once it can start. \`park_arc\` parks or unparks an arc.
- When one piece of work must wait for another, \`set_wait\` with the reason; \`clear_wait\` when it no longer must.
- When only the owner can decide, \`raise_question\` on the arc instead of only asking in chat, holding the increments that need the answer. \`settle_question\` with the answer, in the owner's own words; \`retire_question\` one that was wrong to ask.

Claim, and open the knowledge you need.
- \`claim\` the increment you drive: that starts it. \`claim\` a capability, with a one-line reason, before you touch it. If another session holds it, or it waits on other work, pick other work: nobody queues.
- To start an increment in a workspace of its own, \`make_workspace\`: it cuts a fresh branch from main, makes the worktree and claims the increment in one step, and tells you how to enter it.
- \`open\` the capability to see its shelf: the decisions that are its way into the project's knowledge, as spines. Start at the shelf, open what matches your task, and stop when you can act. \`search_notes\` finds artifacts by their words.

Red, then green, then landed.
- Write a contract's test first, run it, see it fail, and \`report\` it red.
- Make it pass, and \`report\` it green.
- When its contracts pass, \`land\` the capability: your claim on it ends. If you stop before then, \`release\` it.
- When the increment is done, \`close_increment\` with its outcome (landed, failed or withdrawn) and its pull request. Record work that landed without ever being parked with \`park_increment\` and its outcome.

Record what you learned.
- \`write_note\` a decision, definition, principle, guardrail, pattern, process, agent role or tech stack artifact when you learn something worth keeping; give the chosen kind its required fields. With no place named, it goes onto the shelf of the capability you hold. \`correct_note\` fixes an artifact's wording in place.
- \`record_friction\` when something got in your way, with concrete evidence; \`reinforce\` the existing item when it happens again, with its own evidence. \`record_resteer\` when the owner redirects you, quoting their own words.

If storytree says it isn't running, carry on without it.`;

/** The habits card, as the tool server hands it to the agent. */
export function habitsCard(): string {
  return HABITS_CARD;
}
