/** Capability 11 · Workspace: a terminal front door onto the agent link's claimed workspace. */
import { makeWorkspace, type WorkspaceAnswer } from "@storytree/agent-link";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const make: Verb = {
  name: "workspace",
  usage: "workspace <increment|capability> --reason <text>",
  summary: "make a fresh workspace and claim its work for this agent session",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const caller = await context.claimContext();
    const made = await makeWorkspace(caller, id, reason);
    if (!made.ok) throw new Refusal(refusal(id, made));
    const enter = caller.harness === "claude-code"
      ? `Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it.`
      : `Use ${made.folder} as your agent's working folder.`;
    return {
      text: `Made workspace ${made.folder}\nBranch: ${made.branch}, from freshly fetched ${made.base}.\n${caller.session} holds ${id}: ${reason}\n${enter}\nSet it up as this project does at session start.`,
    };
  },
};

/** Present the owning story's refusal without making another claiming rule here. */
function refusal(id: string, answer: Exclude<WorkspaceAnswer, { ok: true }>): string {
  switch (answer.refused) {
    case "held":
      return `${id} is held by ${answer.holder.label} session ${answer.holder.session}: ${answer.holder.reason}. Pick other work.`;
    case "yours":
      return `You already hold ${id}${answer.claim.branch === undefined ? "" : ` on branch ${answer.claim.branch}`}. Work there, or release it first.`;
    case "waiting":
      return `${id} is waiting: ${answer.waits.map((wait) => `${wait.increment} waits on ${wait.onOwner ? "the owner's question " : ""}${wait.on} (${wait.reason})${wait.forGood ? ", which will never release" : ""}`).join("; ")}. Pick other work.`;
    case "closed":
      return `${id} is closed: there is nothing left to claim. Pick other work.`;
    case "unknown-capability":
      return `There is no capability or increment ${id} in this project's plan. Find its id with storytree tree.`;
    case "no-workspace":
      return `No workspace was made: ${answer.why}.`;
  }
}

export const workspace: Family = {
  name: "workspace",
  summary: "make a workspace already claimed for its work",
  verbs: [],
  bare: make,
};
