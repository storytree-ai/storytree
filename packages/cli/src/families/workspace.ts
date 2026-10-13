/** Capability 11 · Workspace: a terminal front door onto Session management's claimed workspace, claim and release, and the user's yes to changing imported code. */
import type { Hold } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Context, Family, Verb } from "../door.js";

const make: Verb = {
  name: "workspace",
  usage: "workspace <increment|capability> --reason <text> [--despite-open-pulls]",
  summary: "make a claimed Claude Code workspace or prepare a Codex app workspace",
  switches: ["despite-open-pulls"],
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const caller = await context.claimContext();
    const { makeWorkspace } = await import("@storytree/session-management");
    const made = await makeWorkspace(caller, id, reason, {}, { despiteOpenPulls: args.has("despite-open-pulls") });
    if (!made.ok) throw new Refusal(workspaceRefusalText(id, made));
    if (made.status === "prepared") {
      const { ref, name } = made;
      return { text: `Work is available; nothing is claimed yet. Call the Codex desktop app's create_worktree with ${JSON.stringify({ ref, name })}, from freshly fetched ${made.base}. Then run storytree workspace attach ${id} --folder <returned-directory> --ref ${ref} --name ${name} --reason <text>. Use the returned directory explicitly; creation does not change your cwd or permissions. If the app returns a directory with a registration error, attach it; do not create another. If create_worktree is unavailable (a headless lane), make it yourself: git worktree add --detach <folder> ${ref}, then run the same attach with that folder.` };
    }
    if (made.existing) return { text: `${caller.session} holds ${id} in this workspace, ${made.folder}, on branch ${made.branch}: no worktree was made.` };
    const enter = `Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it.`;
    return {
      text: `Made workspace ${made.folder}\nBranch: ${made.branch}, from freshly fetched ${made.base}.\n${caller.session} holds ${id}: ${reason}\n${enter}\nSet it up as this project does at session start.`,
    };
  },
};

const attach: Verb = {
  name: "attach",
  usage: "workspace attach <increment|capability> [--folder <directory>] [--ref <commit> --name <name>] --reason <text>",
  summary: "attach an app's worktree (Codex's returned one, or the Claude Code session's own) and claim its work",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const caller = await context.claimContext();
    // Codex attaches the folder create_worktree returned, with its --ref and --name; Claude Code, the worktree it is in.
    const codex = caller.harness === "codex";
    const folder = codex ? args.need("folder", this.usage) : args.text("folder") ?? caller.folder;
    const attachment = codex ? { folder, ref: args.need("ref", this.usage), name: args.need("name", this.usage) } : { folder };
    const { attachWorkspace } = await import("@storytree/session-management");
    const attached = await attachWorkspace(caller, id, reason, attachment);
    if (!attached.ok) throw new Refusal(`${workspaceRefusalText(id, attached)} The app's worktree is kept.`);
    return { text: `Attached workspace ${attached.folder}\nBranch: ${attached.branch}, at ${attached.base}.\n${caller.session} holds ${id}: ${reason}\nUse that directory explicitly for commands. Set it up as this project does at session start.` };
  },
};

const claimOnly: Verb = {
  name: "claim",
  usage: "workspace claim <increment|capability> --reason <text>",
  summary: "claim work for this agent session in the folder it is in, making no worktree (11.9)",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const reason = args.need("reason", this.usage).trim();
    if (!reason) throw new Refusal(`this needs a non-empty --reason\nusage: storytree ${this.usage}`, { code: 2 });
    const caller = await context.claimContext();
    const { claim } = await import("@storytree/session-management");
    const answer = await claim(caller, id, reason);
    if (!answer.ok) throw new Refusal(workspaceRefusalText(id, answer));
    if (answer.alreadyHeld) return { text: `${caller.session} already holds ${id}: no worktree was made.` };
    const taken = answer.takenOverFrom === undefined ? "" : `, taken over from session ${answer.takenOverFrom.session}, which had gone quiet`;
    return { text: `${caller.session} holds ${id}${taken}: ${reason}\nNo worktree was made; work where you are.` };
  },
};

const releaseClaim: Verb = {
  name: "release",
  usage: "workspace release <increment|capability> [--holder <session> --reason <why>]",
  summary: "release a claim this agent session holds, without closing or landing the work; with --holder, the session manager's release of a quiet session's claim (ADR-0944 D7)",
  async act(args, context) {
    const id = args.word(0, "the work's id", this.usage);
    const { release, releaseFor } = await import("@storytree/session-management");
    const caller = await context.claimContext();
    const holder = args.text("holder");
    if (holder !== undefined) {
      const reason = args.need("reason", this.usage).trim();
      if (!reason) throw new Refusal(`this needs a non-empty --reason
usage: storytree ${this.usage}`, { code: 2 });
      const answer = await releaseFor(caller, id, holder, reason);
      if (!answer.ok) {
        const current = answer.holder;
        throw new Refusal(answer.refused === "live"
          ? `${holder} still reads live on ${id}: message it, and release only once it has stayed quiet.`
          : current === undefined ? `${holder} doesn't hold ${id}, and nobody else does.` : `${holder} doesn't hold ${id}: ${current.label} session ${current.session} (${current.reason}) does.`);
      }
      return { text: `Released ${id} for ${holder}: ${reason}${returnedSaid(answer)}` };
    }
    const answer = await release(caller, id);
    if (!answer.ok) {
      const holder = answer.holder;
      throw new Refusal(holder === undefined
        ? `You don't hold ${id}, and nobody else does.`
        : `You don't hold ${id}: ${holder.label} session ${holder.session} (${holder.reason}) does.`);
    }
    return { text: `You released ${id}${returnedSaid(answer)}` };
  },
};

const stale: Verb = {
  name: "stale",
  usage: "workspace stale",
  summary: "the session manager's stale-claim worklist: claimed increments whose holder is quiet, with no command running and no open pull request, each with its route (ADR-0953 D4)",
  async act(_args, context) {
    const caller = await context.activityContext();
    const { staleClaims } = await import("@storytree/session-management");
    const { claims, pullsUnread } = await staleClaims(caller);
    const unread = pullsUnread ? ["GitHub could not be asked which pull requests are open: check each branch before releasing."] : [];
    if (claims.length === 0) return { text: ["No claimed increment is stale.", ...unread].join("\n") };
    const rows = claims.map((claim) =>
      `- ${claim.increment}: ${claim.label} session ${claim.holder} (${claim.reason}), last seen ${claim.lastSeenAt}${claim.branch === undefined ? "" : `, on ${claim.branch}`}. ${
        claim.route === "release"
          ? `Gone: storytree workspace release ${claim.increment} --holder ${claim.holder} --reason <why>.`
          : "Quiet: ask its holder first, and release it only once it stays quiet."}`);
    return { text: [`${claims.length} claimed increment${claims.length === 1 ? " is" : "s are"} stale:`, ...rows, ...unread].join("\n") };
  },
};

/**
 * Asking the owner about an increment releases the work the caller holds for it, through the agent
 * link's releaseAsked (ADR-0944 D4): the question's `--hold` and an owner wait both say so here. A
 * caller holding none of it, a person's shell included, releases nothing and is told nothing.
 */
export async function releasedAsking(context: Context, increment: string): Promise<string> {
  const { releaseAsked } = await import("@storytree/session-management");
  const released = await releaseAsked(await context.activityContext(), increment);
  return released.length === 0 ? "" : ` Released your claims on ${released.join(", ")}.`;
}

/** An increment released without closing is nobody's work in progress: Session management made it a proposal again (11.11). Says so, or ends the sentence. */
function returnedSaid(answer: { returned?: true }): string {
  return answer.returned ? "; nobody holds it, so it is a proposal again." : ".";
}

/**
 * A claim or workspace Session management refused, as this door words it: the door's own copy of the
 * fields it reads of the refusal (ADR-1017 D2).
 */
type Refused = { readonly ok: false } & (
  | { readonly refused: "held"; readonly holder: { readonly session: string; readonly label: string; readonly reason: string; readonly binds?: string }; readonly heldFor: readonly string[] }
  | { readonly refused: "yours"; readonly claim: { readonly branch?: string } }
  | { readonly refused: "waiting"; readonly waits: readonly Waiting[] }
  | { readonly refused: "closed" }
  | { readonly refused: "unknown-capability" }
  | { readonly refused: "reason-too-long"; readonly limit: number; readonly length: number }
  | { readonly refused: "no-workspace"; readonly why: string; readonly openPulls?: readonly unknown[] });

/** Present the owning story's refusal without making another claiming rule here. */
export function workspaceRefusalText(id: string, answer: Refused): string {
  switch (answer.refused) {
    case "held":
      return `${id} is held by ${answer.holder.label} session ${answer.holder.session}${answer.heldFor.length === 0 ? "" : ` for ${answer.heldFor.join(", ")}`}: ${answer.holder.reason}${answer.holder.binds === undefined ? "" : `; binds: ${answer.holder.binds}`}. Pick other work${answer.heldFor.length === 0 ? "" : `; this is free once ${answer.heldFor[0]} closes`}.`;
    case "yours":
      return `You already hold ${id}${answer.claim.branch === undefined ? "" : ` on branch ${answer.claim.branch}`}. Work there, or release it first.`;
    case "waiting":
      return `${id} is waiting: ${answer.waits.map(waitSaid).join("; ")}. Pick other work.`;
    case "closed":
      return `${id} is closed: there is nothing left to claim. Pick other work.`;
    case "unknown-capability":
      return `There is no capability or increment ${id} in this project's plan. Find its id with storytree tree.`;
    case "reason-too-long":
      return `--reason is ${answer.length} characters; it is the session's name in the sessions list, so keep it to ${answer.limit} or fewer.`;
    case "no-workspace":
      // The owning story words the open pull requests refusal; this door names its own way past them (5.25).
      if (answer.openPulls !== undefined) {
        return `Workspace setup refused: ${answer.why}: storytree workspace ${id} --reason <text> --despite-open-pulls.`;
      }
      return `Workspace setup refused: ${answer.why}.`;
  }
}

/** One thing holding work a claim was refused on, as Session management gives it. */
type Waiting = Hold & { readonly increment: string; readonly onOwner?: true; readonly waitsFor?: "owner" | "event"; readonly checkBack?: string };

/** One thing holding the work: other work, the owner's question, or the owner or an outside event it waits for with a note (ADR-0938 D1). */
function waitSaid(wait: Waiting): string {
  if (wait.waitsFor === "owner") return `${wait.increment} waits for the owner: ${wait.reason}`;
  if (wait.waitsFor === "event") return `${wait.increment} waits for an outside event: ${wait.reason} (check back ${wait.checkBack})`;
  return `${wait.increment} waits on ${wait.onOwner ? "the owner's question " : ""}${wait.on} (${wait.reason})${wait.forGood ? ", which will never release" : ""}`;
}

const allow: Verb = {
  name: "allow",
  usage: "workspace allow <increment>",
  summary: "say yes, at your own terminal, to the agent changing your imported code for an increment, where its harness cannot ask you at the edit (ADR-1015)",
  async act(args, context) {
    const id = args.word(0, "the increment's id", this.usage);
    const caller = await context.activityContext();
    // The yes is the user's own: never from an agent's shell, nor from anything that is not a person at a terminal (ADR-1015 D2).
    if (!caller.session.startsWith("person:")) throw new Refusal(`An agent cannot give the user's yes: ask the user, and if they agree, they run \`storytree ${this.usage}\` at their own terminal.`);
    if (process.stdin.isTTY !== true) throw new Refusal("This needs you at your own terminal: run it there, not through a pipe or a script.");
    const { allowIncrement } = await import("@storytree/session-management");
    const allowed = await allowIncrement(caller, caller.session.slice("person:".length), id);
    if (!allowed.ok) throw new Refusal(allowed.reason);
    const named = allowed.capabilities.map(({ capability, covers }) => `  ${capability}: ${covers.length === 0 ? "(covers nothing yet)" : covers.join(", ")}`);
    return { text: `Allowed: the agent may change your imported code for ${id}, in what it lists now:\n${named.join("\n")}\nA capability added to its list later, or a cover widened, is asked again.` };
  },
};

export const workspace: Family = {
  name: "workspace",
  summary: "prepare or attach a workspace, claim or release work for this agent session, list stale claims, or allow an increment's changes to imported code",
  verbs: [attach, claimOnly, releaseClaim, stale, allow],
  bare: make,
};
