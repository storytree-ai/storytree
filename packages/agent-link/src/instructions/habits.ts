/**
 * Capability 7 · Instructions, the habits card (the agent link story): one short text, a screen or
 * less, that teaches the agent storytree's habits. The tool server hands it to the agent at the
 * start of every session, as its instructions; Claude Code and Codex both read it from there.
 *
 * The card names each tool in backticks, and uses backticks for nothing else: its tests hold it to
 * naming exactly the tools the server has, within 60 lines.
 */
const HABITS_CARD = `storytree keeps the plan of this project and records what you do, so the user can watch it grow. Work with it like this.

Start every session with \`check_setup\`, and do what it says. If this folder isn't a storytree project, carry on without storytree: never offer to set it up. Call \`set_up_project\` only when the user asks for storytree here, with a name no project has (a refusal suggests one); set its join only when they ask to add this computer's copy of a project they already have elsewhere.

Plan first.
- \`show_plan\` shows the plan: every story, capability and contract with its health, who holds what, and which sessions are about. \`health_worklist\` lists the oldest capabilities that are not healthy, with why and who moves each: route each into an increment that touches it, held on a question when only the owner can move it.
- Plan a story (something a user can do) with \`plan_story\`, the parts that make it work with \`plan_capability\`, and each testable promise with \`plan_contract\`. A story or capability starts with its founding decision: what it is for, and the one choice that shapes it. Group stories under an initiative with \`plan_arc\`. Correct any of them with \`edit_plan\`, and \`retire_from_plan\` a capability or contract no longer wanted, with the reason.
- Break an arc's work into increments with \`park_increment\` (the breakdown goes in its body), and \`ready_increment\` one once it can start. \`move_increment\` re-homes one on another arc, keeping its id. \`park_arc\` parks or unparks an arc.
- When one piece of work must wait for another, \`set_wait\` with the reason; \`clear_wait\` when it no longer must.
- When only the owner can decide, \`raise_question\` on the arc instead of only asking in chat, holding the increments that need the answer. \`correct_question\` fixes its wording while it is open. \`settle_question\` with the answer, in the owner's own words; \`retire_question\` one that was wrong to ask.

Claim, and open the knowledge you need.
- \`claim\` the increment you drive: that starts it. \`claim\` a capability before you touch it. Your reason names your session in the sessions list: 40 characters or fewer. If another session holds it, or it waits on other work, pick other work: nobody queues.
- Once you know what you are doing, \`name_session\` names your row in the sessions list, in 40 characters or fewer; name it again when your work shifts. Until you do, the row reads your claim's reason, or your harness and folder.
- To start work in its own workspace, call \`make_workspace\` before claiming it. Claude Code gets a claimed worktree and instructions to enter it. For Codex, it checks availability and returns ref and name: call the desktop app’s create_worktree with those exact arguments, then \`attach_workspace\` with the returned folder, ref, name and your reason. Use that directory explicitly; creation does not change your cwd. If the app returns a folder with a registration error, attach it; do not create another. The app owns the folder, including after a refusal.
- \`open\` the capability to see its shelf: the decisions that are its way into the project's knowledge, as spines. Start at the shelf, open what matches your task, and stop when you can act. \`search_notes\` finds the artifacts closest in meaning to a question.

Red, then green, then landed.
- Write a contract's test first, run it, see it fail, and \`report\` it red.
- Make it pass, and \`report\` it green.
- When its contracts pass, \`land\` the capability: your claim on it ends. If you stop before then, \`release\` it.
- A capability is proposed until you \`mark_built\` it, once you consider it built. Its card then says healthy, unhealthy or untested from what storytree verified, never from your report.
- At an increment boundary, \`read_context\` says how many tokens your context holds; judge whether to take on more.
- When the increment is done, \`close_increment\` with its outcome (landed, failed or withdrawn) and its pull request. Record work that landed without ever being parked with \`park_increment\` and its outcome.
- When your session's work is done, \`close_out\`: say whether it is safe to close (pull requests merged, tree clean, nothing of yours running) and why. The sessions list checks a yes; anything it cannot bear out stays listed for the owner.

Record what you learned.
- \`write_note\` a decision, definition, principle, guardrail, pattern, process, agent role or tech stack artifact when you learn something worth keeping; give the chosen kind its required fields. With no place named, it goes onto the shelf of the capability you hold. \`correct_note\` fixes an artifact's wording in place.
- \`record_friction\` when something got in your way, with concrete evidence; \`reinforce\` the existing item when it happens again, with its own evidence. \`record_resteer\` when the owner redirects you, quoting their own words.

Use \`list_own_runs\` for this caller’s recorded work, \`list_all_runs\` for every recorded session on this computer, \`stop_own_run\` for named runs you own, and \`clear_own_runs\` to remove only your confirmed-gone records and read what remains on this computer. These tools work with the app offline; uncertain caller identity grants no stop authority.

If storytree says it isn't running, carry on without it.`;

/** The habits card, as the tool server hands it to the agent. */
export function habitsCard(): string {
  return HABITS_CARD;
}
