/** Capability 11 · Workspace: a terminal front door onto the agent link's claimed workspace and release. */
import { attachWorkspace, makeWorkspace, release, type WorkspaceAnswer } from "@storytree/agent-link";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const make: Verb = {
  name: "workspace",
  usage: "workspace <increment|capability> --reason <text>",
  summary: "make a claimed Claude Code workspace or prepare a Codex app workspace",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const caller = await context.claimContext();
    const made = await makeWorkspace(caller, id, reason);
    if (!made.ok) throw new Refusal(refusal(id, made));
    if (made.status === "prepared") {
      const { ref, name } = made;
      return { text: `Work is available; nothing is claimed yet. Call the Codex desktop app's create_worktree with ${JSON.stringify({ ref, name })}, from freshly fetched ${made.base}. Then run storytree workspace attach ${id} --folder <returned-directory> --ref ${ref} --name ${name} --reason <text>. Use the returned directory explicitly; creation does not change your cwd or permissions. If the app returns a directory with a registration error, attach it; do not create another. If create_worktree is unavailable, continue in the Codex desktop app.` };
    }
    const enter = `Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it.`;
    return {
      text: `Made workspace ${made.folder}\nBranch: ${made.branch}, from freshly fetched ${made.base}.\n${caller.session} holds ${id}: ${reason}\n${enter}\nSet it up as this project does at session start.`,
    };
  },
};

const attach: Verb = {
  name: "attach",
  usage: "workspace attach <increment|capability> --folder <directory> --ref <commit> --name <name> --reason <text>",
  summary: "attach the Codex app's returned worktree and claim its work",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const attachment = { folder: args.need("folder", this.usage), ref: args.need("ref", this.usage), name: args.need("name", this.usage) };
    const caller = await context.claimContext();
    const attached = await attachWorkspace(caller, id, reason, attachment);
    if (!attached.ok) throw new Refusal(`${refusal(id, attached)} The app's worktree is kept.`);
    return { text: `Attached workspace ${attached.folder}\nBranch: ${attached.branch}, at ${attached.base}.\n${caller.session} holds ${id}: ${reason}\nUse that directory explicitly for commands. Set it up as this project does at session start.` };
  },
};

const releaseClaim: Verb = {
  name: "release",
  usage: "workspace release <increment|capability>",
  summary: "release a claim this agent session holds, without closing or landing the work",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const answer = await release(await context.claimContext(), id);
    if (!answer.ok) {
      const holder = answer.holder;
      throw new Refusal(holder === undefined
        ? `You don't hold ${id}, and nobody else does.`
        : `You don't hold ${id}: ${holder.label} session ${holder.session} (${holder.reason}) does.`);
    }
    return { text: `You released ${id}.` };
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
    case "reason-too-long":
      return `--reason is ${answer.length} characters; it is the session's name in the sessions list, so keep it to ${answer.limit} or fewer.`;
    case "no-workspace":
      return `Workspace setup refused: ${answer.why}.`;
  }
}

export const workspace: Family = {
  name: "workspace",
  summary: "prepare or attach a workspace, or release this agent session's claim",
  verbs: [attach, releaseClaim],
  bare: make,
};
