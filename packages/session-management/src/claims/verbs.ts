/**
 * Capability 5 · Claims. The workspace verbs, declared once (ADR-0969 D2, ADR-1033): make or attach a claimed
 * workspace, claim or release work for the calling agent session, list the stale claims, and the user's yes to
 * changing imported code. The command line mounts them as its `workspace` family (WORKSPACE_FAMILIES); the MCP server still answers the
 * same work through its own tools, so none is mounted as a tool here.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/project-and-caller/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import type { Waiting } from "./claims.js";
import type { WorkspaceRefusal } from "./workspace.js";

/** Why a workspace verb has no tool: the MCP server's own tool for the work, which it keeps until it mounts this one. */
function ownTool(tool: string) {
  return { absent: `the MCP server answers this with its own ${tool} tool` } as const;
}

/** A claim belongs to the agent session that will work there: a person's shell, which has none, is refused. */
function agentOnly(context: SessionVerbContext): void {
  if (context.session.startsWith("person:")) throw new VerbRefusal("Run workspace from the agent's shell: a claim belongs to the agent session that will work there.");
}

const work = { kind: "text", word: 0, describe: "the work's id: an increment or a capability" } as const;
const reason = { kind: "text", describe: "why this session takes it: its name in the sessions list" } as const;

const make = verb({
  command: {
    family: "workspace",
    name: "workspace",
    summary: "make a claimed Claude Code workspace or prepare a Codex app workspace",
    usage: "workspace <increment|capability> --reason <text> [--despite-open-pulls]",
  },
  tool: ownTool("make_workspace"),
  inputs: { work, reason, "despite-open-pulls": { kind: "switch", describe: "make it beside the work's open pull request" } },
  async act({ work: id, reason: why, "despite-open-pulls": despiteOpenPulls }, context: SessionVerbContext) {
    agentOnly(context);
    const { makeWorkspace } = await import("./workspace.js");
    const made = await makeWorkspace(context, id, why, {}, { despiteOpenPulls });
    if (!made.ok) throw new VerbRefusal(workspaceRefusalText(id, made));
    if (made.status === "prepared") {
      const { ref, name } = made;
      return { text: `Work is available; nothing is claimed yet. Call the Codex desktop app's create_worktree with ${JSON.stringify({ ref, name })}, from freshly fetched ${made.base}. Then run storytree workspace attach ${id} --folder <returned-directory> --ref ${ref} --name ${name} --reason <text>. Use the returned directory explicitly; creation does not change your cwd or permissions. If the app returns a directory with a registration error, attach it; do not create another. If create_worktree is unavailable (a headless lane), make it yourself: git worktree add --detach <folder> ${ref}, then run the same attach with that folder.` };
    }
    if (made.existing) return { text: `${context.session} holds ${id} in this workspace, ${made.folder}, on branch ${made.branch}: no worktree was made.` };
    const enter = `Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it.`;
    return {
      text: `Made workspace ${made.folder}\nBranch: ${made.branch}, from freshly fetched ${made.base}.\n${context.session} holds ${id}: ${why}\n${enter}\nSet it up as this project does at session start.`,
    };
  },
});

const attach = verb({
  command: {
    family: "workspace",
    name: "attach",
    summary: "attach an app's worktree (Codex's returned one, or the Claude Code session's own) and claim its work",
    usage: "workspace attach <increment|capability> [--folder <directory>] [--ref <commit> --name <name>] --reason <text>",
  },
  tool: ownTool("attach_workspace"),
  inputs: {
    work,
    folder: { kind: "text", optional: true, describe: "the worktree's directory: Codex's returned one, else the folder this runs in" },
    ref: { kind: "text", optional: true, describe: "Codex: the commit preparation pinned" },
    name: { kind: "text", optional: true, describe: "Codex: the worktree's name preparation gave" },
    reason,
  },
  async act({ work: id, folder, ref, name, reason: why }, context: SessionVerbContext) {
    agentOnly(context);
    // Codex attaches the folder create_worktree returned, with its --ref and --name; Claude Code, the worktree it is in.
    const needed = (flag: string, value: string | undefined): string => {
      if (value === undefined) throw new VerbRefusal(`this needs --${flag}`, { misuse: true });
      return value;
    };
    const codex = context.harness === "codex";
    const attachment = codex ? { folder: needed("folder", folder), ref: needed("ref", ref), name: needed("name", name) } : { folder: folder ?? context.folder };
    const { attachWorkspace } = await import("./workspace.js");
    const attached = await attachWorkspace(context, id, why, attachment);
    if (!attached.ok) throw new VerbRefusal(`${workspaceRefusalText(id, attached)} The app's worktree is kept.`);
    return { text: `Attached workspace ${attached.folder}\nBranch: ${attached.branch}, at ${attached.base}.\n${context.session} holds ${id}: ${why}\nUse that directory explicitly for commands. Set it up as this project does at session start.` };
  },
});

const claimOnly = verb({
  command: { family: "workspace", name: "claim", summary: "claim work for this agent session in the folder it is in, making no worktree (11.9)", usage: "workspace claim <increment|capability> --reason <text>" },
  tool: ownTool("claim"),
  inputs: { work, reason },
  async act({ work: id, reason: why }, context: SessionVerbContext) {
    agentOnly(context);
    const { claim } = await import("./claims.js");
    const answer = await claim(context, id, why);
    if (!answer.ok) throw new VerbRefusal(workspaceRefusalText(id, answer));
    if (answer.alreadyHeld) return { text: `${context.session} already holds ${id}: no worktree was made.` };
    const taken = answer.takenOverFrom === undefined ? "" : `, taken over from session ${answer.takenOverFrom.session}, which had gone quiet`;
    return { text: `${context.session} holds ${id}${taken}: ${why}\nNo worktree was made; work where you are.` };
  },
});

const releaseClaim = verb({
  command: {
    family: "workspace",
    name: "release",
    summary: "release a claim this agent session holds, without closing or landing the work; with --holder, the session manager's release of a quiet session's claim (ADR-0944 D7)",
    usage: "workspace release <increment|capability> [--holder <session> --reason <why>]",
  },
  tool: ownTool("release"),
  inputs: {
    work,
    holder: { kind: "text", optional: true, describe: "the quiet session whose claim the session manager releases" },
    reason: { kind: "text", optional: true, describe: "with --holder: why its claim is released" },
  },
  async act({ work: id, holder, reason: why }, context: SessionVerbContext) {
    agentOnly(context);
    const { release, releaseFor } = await import("./claims.js");
    if (holder !== undefined) {
      if (why === undefined) throw new VerbRefusal("this needs --reason", { misuse: true });
      const answer = await releaseFor(context, id, holder, why);
      if (!answer.ok) {
        const current = answer.holder;
        throw new VerbRefusal(answer.refused === "live"
          ? `${holder} still reads live on ${id}: message it, and release only once it has stayed quiet.`
          : current === undefined ? `${holder} doesn't hold ${id}, and nobody else does.` : `${holder} doesn't hold ${id}: ${current.label} session ${current.session} (${current.reason}) does.`);
      }
      return { text: `Released ${id} for ${holder}: ${why}${returnedSaid(answer)}` };
    }
    const answer = await release(context, id);
    if (!answer.ok) {
      const current = answer.holder;
      throw new VerbRefusal(current === undefined
        ? `You don't hold ${id}, and nobody else does.`
        : `You don't hold ${id}: ${current.label} session ${current.session} (${current.reason}) does.`);
    }
    return { text: `You released ${id}${returnedSaid(answer)}` };
  },
});

const stale = verb({
  command: {
    family: "workspace",
    name: "stale",
    summary: "the session manager's stale-claim worklist: claimed increments whose holder is quiet, with no command running and no open pull request, each with its route (ADR-0953 D4)",
  },
  tool: ownTool("stale_claims"),
  inputs: {},
  async act(_input, context: SessionVerbContext) {
    const { staleClaims } = await import("./stale-claims.js");
    const { claims, pullsUnread } = await staleClaims(context);
    const unread = pullsUnread ? ["GitHub could not be asked which pull requests are open: check each branch before releasing."] : [];
    if (claims.length === 0) return { text: ["No claimed increment is stale.", ...unread].join("\n") };
    const rows = claims.map((claim) =>
      `- ${claim.increment}: ${claim.label} session ${claim.holder} (${claim.reason}), last seen ${claim.lastSeenAt}${claim.branch === undefined ? "" : `, on ${claim.branch}`}. ${
        claim.route === "release"
          ? `Gone: storytree workspace release ${claim.increment} --holder ${claim.holder} --reason <why>.`
          : "Quiet: ask its holder first, and release it only once it stays quiet."}`);
    return { text: [`${claims.length} claimed increment${claims.length === 1 ? " is" : "s are"} stale:`, ...rows, ...unread].join("\n") };
  },
});

const allow = verb({
  command: {
    family: "workspace",
    name: "allow",
    summary: "say yes, at your own terminal, to the agent changing your imported code for an increment, where its harness cannot ask you at the edit (ADR-1015)",
    usage: "workspace allow <increment>",
  },
  tool: { absent: "the yes is the user's own, given at their own terminal, never by an agent (ADR-1015 D2)" },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" } },
  async act({ increment: id }, context: SessionVerbContext, words) {
    // The yes is the user's own: never from an agent's shell, nor from anything that is not a person at a terminal (ADR-1015 D2).
    if (!context.session.startsWith("person:")) throw new VerbRefusal(`An agent cannot give the user's yes: ask the user, and if they agree, they run \`${words.say({ command: "workspace allow <increment>" })}\` at their own terminal.`);
    if (process.stdin.isTTY !== true) throw new VerbRefusal("This needs you at your own terminal: run it there, not through a pipe or a script.");
    const { allowIncrement } = await import("./edit-gate.js");
    const allowed = await allowIncrement(context, context.session.slice("person:".length), id);
    if (!allowed.ok) throw new VerbRefusal(allowed.reason);
    const named = allowed.capabilities.map(({ capability, covers }) => `  ${capability}: ${covers.length === 0 ? "(covers nothing yet)" : covers.join(", ")}`);
    return { text: `Allowed: the agent may change your imported code for ${id}, in what it lists now:\n${named.join("\n")}\nA capability added to its list later, or a cover widened, is asked again.` };
  },
});

const pr = { kind: "text", word: 0, describe: "the pull request's number" } as const;

/** A pull request's number, as typed. */
function prNumber(typed: string): number {
  if (!/^\d+$/.test(typed)) throw new VerbRefusal(`${typed} is not a pull request's number`, { misuse: true });
  return Number(typed);
}

const holdForPr = verb({
  command: {
    family: "workspace",
    name: "hold",
    summary: "the watcher's: keep every claim a session holds for its handed-over pull request until it merges or closes (ADR-1037 D1)",
    usage: "workspace hold <pr> --holder <session> --branch <branch>",
  },
  tool: { absent: "the Mint box's watcher runs it when a session hands a pull request over" },
  inputs: {
    pr,
    holder: { kind: "text", describe: "the session that handed the pull request over" },
    branch: { kind: "text", describe: "the pull request's branch: its merge ends the claims" },
  },
  async act({ pr: typed, holder, branch }, context: SessionVerbContext) {
    const { holdForPull } = await import("./claims.js");
    const held = await holdForPull(context, holder, prNumber(typed), branch);
    return { text: held.length === 0 ? `${holder} holds nothing, so nothing is held for PR #${typed}.` : `Held for PR #${typed} until it merges or closes: ${held.join(", ")}.` };
  },
});

const letGoOfPr = verb({
  command: {
    family: "workspace",
    name: "let-go",
    summary: "the watcher's: end every claim held for a pull request, on its merge or closing or when it is given up (ADR-1037 D1, D3)",
    usage: "workspace let-go <pr> --reason <why>",
  },
  tool: { absent: "the Mint box's watcher runs it when a handed-over pull request merges, closes or is given up" },
  inputs: { pr, reason: { kind: "text", describe: "why its claims end" } },
  async act({ pr: typed, reason: why }, context: SessionVerbContext) {
    const { letGo } = await import("./claims.js");
    const released = await letGo(context, prNumber(typed), why);
    return { text: released.length === 0 ? `Nothing is held for PR #${typed}.` : `Released what PR #${typed} held: ${released.join(", ")}.` };
  },
});

/** The command line's `workspace` family, which the package's manifest names under `verbs` (ADR-1033): its bare name makes a workspace. */
export const WORKSPACE_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [{
  name: "workspace",
  summary: "prepare or attach a workspace, claim or release work for this agent session, list stale claims, or allow an increment's changes to imported code",
  order: 23,
  verbs: [attach, claimOnly, releaseClaim, stale, allow, holdForPr, letGoOfPr],
  bare: make,
}];

/** An increment released without closing is nobody's work in progress: it is a proposal again (11.11). Says so, or ends the sentence. */
function returnedSaid(answer: { returned?: true }): string {
  return answer.returned ? "; nobody holds it, so it is a proposal again." : ".";
}

/** A refused claim or workspace, as the command line words it. */
export function workspaceRefusalText(id: string, answer: WorkspaceRefusal): string {
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
      // The refusal words the open pull requests; the command line names its own way past them (5.25).
      if (answer.openPulls !== undefined) {
        return `Workspace setup refused: ${answer.why}: storytree workspace ${id} --reason <text> --despite-open-pulls.`;
      }
      return `Workspace setup refused: ${answer.why}.`;
  }
}

/** One thing holding the work: other work, the owner's question, or the owner or an outside event it waits for with a note (ADR-0938 D1). */
function waitSaid(wait: Waiting): string {
  if (wait.waitsFor === "owner") return `${wait.increment} waits for the owner: ${wait.reason}`;
  if (wait.waitsFor === "event") return `${wait.increment} waits for an outside event: ${wait.reason} (check back ${wait.checkBack})`;
  return `${wait.increment} waits on ${wait.onOwner ? "the owner's question " : ""}${wait.on} (${wait.reason})${wait.forGood ? ", which will never release" : ""}`;
}
