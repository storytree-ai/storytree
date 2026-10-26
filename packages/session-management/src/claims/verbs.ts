/**
 * Capability 5 · Claims. The workspace verbs, declared once (ADR-0969 D2, ADR-1033): make or attach a claimed
 * workspace, claim or release work for the calling agent session, list the stale claims, and the user's yes to
 * changing imported code. The command line mounts them as its `workspace` family (WORKSPACE_FAMILIES); the MCP server answers the
 * same work through Session management's tool part (tools.ts), so none is mounted as a tool here.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import type { Waiting } from "./claims.js";
import type { WorkspaceRefusal } from "./workspace.js";

/** Why a workspace verb has no tool: Session management's own tool for the work, served from its tool part (tools.ts). */
function ownTool(tool: string) {
  return { absent: `Session management's own ${tool} tool answers this` } as const;
}

/** A claim belongs to the agent session that will work there: a person's shell, which has none, is refused. */
function agentOnly(context: SessionVerbContext): void {
  if (context.session.startsWith("person:")) throw new VerbRefusal("Run workspace from the agent's shell: a claim belongs to the agent session that will work there.");
}

const work = { kind: "text", word: 0, describe: "the work's id: an increment or a capability" } as const;
const reason = { kind: "text", describe: "why this session takes it: its name in the sessions list" } as const;

const make = verb({
  consumers: ["agent"],
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
    const { setupText } = await import("./worktree-setup.js");
    const setUp = made.setup === undefined ? "Set it up as this project does at session start." : setupText(made.setup);
    return {
      text: `Made workspace ${made.folder}\nBranch: ${made.branch}, from freshly fetched ${made.base}.\n${context.session} holds ${id}: ${why}\n${enter}\n${setUp}`,
    };
  },
});

const attach = verb({
  consumers: ["agent"],
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
    const { setupText } = await import("./worktree-setup.js");
    const setUp = attached.setup === undefined ? "Set it up as this project does at session start." : setupText(attached.setup);
    return { text: `Attached workspace ${attached.folder}\nBranch: ${attached.branch}, at ${attached.base}.\n${context.session} holds ${id}: ${why}\nUse that directory explicitly for commands. ${setUp}` };
  },
});

const claimOnly = verb({
  consumers: ["agent"],
  command: {
    family: "workspace",
    name: "claim",
    summary: "claim work for this agent session in the folder it is in, making no worktree (11.9); several capabilities at once, all or nothing, in ascending id order (11.18, ADR-1079 D2)",
    usage: "workspace claim <increment|capability> [<capability> ...] --reason <text>",
  },
  tool: ownTool("claim"),
  inputs: { work: { kind: "text", word: 0, many: true, describe: "the work's id: an increment or a capability; or several capabilities, as words or a comma list" }, reason },
  async act({ work: given, reason: why }, context: SessionVerbContext) {
    agentOnly(context);
    const ids = given.flatMap((word) => word.split(",")).filter((id) => id !== "");
    const { claim, claimAll } = await import("./claims.js");
    if (ids.length > 1) {
      const all = await claimAll(context, ids, why);
      if (!all.ok) throw new VerbRefusal(`${workspaceRefusalText(all.id, all.refusal)}\nNone of ${ids.join(", ")} is held by this call.`);
      return { text: `${context.session} holds ${all.claims.map(({ claim: { capability, increment } }) => capability ?? increment).join(", ")}: ${why}\nNo worktree was made; work where you are.` };
    }
    const id = ids[0];
    if (id === undefined) throw new VerbRefusal("this needs the work's id", { misuse: true });
    const answer = await claim(context, id, why);
    if (!answer.ok) throw new VerbRefusal(workspaceRefusalText(id, answer));
    if (answer.alreadyHeld) return { text: `${context.session} already holds ${id}: no worktree was made.` };
    const taken = answer.takenOverFrom === undefined ? "" : `, taken over from session ${answer.takenOverFrom.session}, which had gone quiet`;
    return { text: `${context.session} holds ${id}${taken}: ${why}\nNo worktree was made; work where you are.` };
  },
});

const releaseClaim = verb({
  consumers: ["agent"],
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
  consumers: ["agent"],
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
  consumers: ["user"],
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

const approveSetup = verb({
  consumers: ["user"],
  command: {
    family: "workspace",
    name: "approve-setup",
    summary: "approve, at your own terminal, the commands a project's checked-in .storytree/worktree.json runs in each new worktree, by the fingerprint a workspace's answer named",
    usage: "workspace approve-setup <fingerprint>",
  },
  tool: { absent: "the approval is the user's own, given at their own terminal, never by an agent" },
  inputs: { fingerprint: { kind: "text", word: 0, describe: "the fingerprint of the commands, as the workspace's answer named it" } },
  async act({ fingerprint }, context: SessionVerbContext, words) {
    // A checked-in command runs only once the user has seen and approved it: never on an agent's say (19.7).
    if (!context.session.startsWith("person:")) throw new VerbRefusal(`An agent cannot approve the project's setup commands: ask the user, and if they agree, they run \`${words.say({ command: "workspace approve-setup <fingerprint>" })}\` at their own terminal.`);
    if (process.stdin.isTTY !== true) throw new VerbRefusal("This needs you at your own terminal: run it there, not through a pipe or a script.");
    const { approveCheckedInSetup } = await import("./worktree-setup.js");
    const approved = approveCheckedInSetup(context.folder, fingerprint);
    if (!approved.ok) throw new VerbRefusal(approved.reason);
    return { text: `Approved: each workspace made from now on runs these commands from the project's checked-in setup:\n${approved.commands.map((one) => `  ${one}`).join("\n")}\nIf they change, you are asked again.` };
  },
});

const pr = { kind: "text", word: 0, describe: "the pull request's number" } as const;

/** A pull request's number, as typed. */
function prNumber(typed: string): number {
  if (!/^\d+$/.test(typed)) throw new VerbRefusal(`${typed} is not a pull request's number`, { misuse: true });
  return Number(typed);
}

const holdForPr = verb({
  consumers: ["agent"],
  command: {
    family: "workspace",
    name: "hold",
    summary: "the watcher's: keep the claims a session took on its handed-over pull request's branch for it until it merges or closes (ADR-1037 D1)",
    usage: "workspace hold <pr> --holder <session> --branch <branch> [--increment <increment>]",
  },
  tool: { absent: "the Mint box's watcher runs it when a session hands a pull request over" },
  inputs: {
    pr,
    holder: { kind: "text", describe: "the session that handed the pull request over" },
    branch: { kind: "text", describe: "the pull request's branch: its merge ends the claims" },
    increment: { kind: "text", optional: true, describe: "the increment handed over: the session's claims on it, or under it, taken on no branch are held too" },
  },
  async act({ pr: typed, holder, branch, increment }, context: SessionVerbContext) {
    const { holdForPull } = await import("./claims.js");
    const held = await holdForPull(context, holder, prNumber(typed), branch, increment);
    return { text: held.length === 0 ? `${holder} holds nothing, so nothing is held for PR #${typed}.` : `Held for PR #${typed} until it merges or closes: ${held.join(", ")}.` };
  },
});

const letGoOfPr = verb({
  consumers: ["agent"],
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

const redPr = verb({
  consumers: ["agent"],
  command: {
    family: "workspace",
    name: "red",
    summary: "the watcher's: record a handed-over pull request found red as it starts its fix session, a pr-red activity line (ADR-1064 D4)",
    usage: "workspace red <pr> --increment <id> [--conflict] [--check <name> ...]",
  },
  tool: { absent: "the Mint box's watcher runs it when it starts a fix session for a red pull request" },
  inputs: {
    pr,
    increment: { kind: "text", describe: "the increment the pull request was handed over for" },
    conflict: { kind: "switch", describe: "the pull request conflicts with main" },
    check: { kind: "text", many: true, optional: true, describe: "a failed check's name" },
  },
  async act({ pr: typed, increment, conflict, check }, context: SessionVerbContext) {
    const { recordRed } = await import("./claims.js");
    await recordRed(context, prNumber(typed), increment, conflict, [...check]);
    return { text: `Recorded PR #${typed} red${conflict ? ", conflicting with main" : ""}${check.length === 0 ? "" : `: ${check.join(", ")} failed`}.` };
  },
});

const rerunCi = verb({
  consumers: ["agent"],
  command: {
    family: "workspace",
    name: "rerun",
    summary: "the watcher's: record a CI run it reran, a ci-rerun activity line naming the repository, the run and the attempt it starts",
    usage: "workspace rerun <run> --repo <owner/name> --attempt <n> --what main|release|pr",
  },
  tool: { absent: "the Mint box's watcher runs it when it reruns main's CI, a release run or a handed-over pull request's CI" },
  inputs: {
    run: { kind: "text", word: 0, describe: "the CI run's id" },
    repo: { kind: "text", describe: "the GitHub repository, as owner/name" },
    attempt: { kind: "count", describe: "the attempt the rerun starts" },
    what: { kind: "text", describe: "main, for main's CI run, release, or pr, for a handed-over pull request's CI run" },
  },
  async act({ run, repo, attempt, what }, context: SessionVerbContext) {
    if (!/^\d+$/.test(run)) throw new VerbRefusal(`${run} is not a CI run's id`, { misuse: true });
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new VerbRefusal(`${repo} is not a repository as owner/name`, { misuse: true });
    if (attempt < 2) throw new VerbRefusal("a rerun starts attempt 2 or later", { misuse: true });
    if (what !== "main" && what !== "release" && what !== "pr") throw new VerbRefusal(`--what is main, release or pr, not ${what}`, { misuse: true });
    const { recordRerun } = await import("./claims.js");
    await recordRerun(context, { repo, run: Number(run), attempt, what });
    return { text: `Recorded the watcher's rerun of ${repo} run ${run}, attempt ${attempt}.` };
  },
});

/** The command line's `workspace` family, which the package's manifest names under `verbs` (ADR-1033): its bare name makes a workspace. */
export const WORKSPACE_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [{
  name: "workspace",
  summary: "prepare or attach a workspace, claim or release work for this agent session, list stale claims, allow an increment's changes to imported code, or approve a project's checked-in worktree setup",
  order: 23,
  verbs: [attach, claimOnly, releaseClaim, stale, allow, approveSetup, holdForPr, letGoOfPr, redPr, rerunCi],
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
      return `${"listed" in answer ? `${answer.listed}, on ${id}'s capabilities list,` : id} is held by ${answer.holder.label} session ${answer.holder.session}${answer.heldFor.length === 0 ? "" : ` for ${answer.heldFor.join(", ")}`}: ${answer.holder.reason}${answer.holder.binds === undefined ? "" : `; binds: ${answer.holder.binds}`}. Pick other work${answer.heldFor.length === 0 ? "" : `; this is free once ${answer.heldFor[0]} closes`}.`;
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
