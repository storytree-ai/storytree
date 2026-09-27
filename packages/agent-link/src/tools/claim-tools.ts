/**
 * The claiming and reporting tools: claim or release a capability or an increment (claiming an
 * increment starts it, ADR-0643 D1), report a contract red or green, and report a capability
 * landed. A claim on waiting work is refused, naming what it waits for (W2, ADR-0643 D2). And make
 * a workspace already claimed for a piece of work, in one step (ADR-0653, the owner's K1).
 */
import type { Library } from "@storytree/library";
import { z } from "zod";

import { attachWorkspace, claim, currentBranch, increments, land, makeWorkspace, release, type Claim, type ClaimAnswer, type ClaimContext, type WorkspaceRefusal } from "../claims/index.js";
import { refusalOf } from "./answers.js";
import { lineOf, type Call, type Define, type ToolExtension } from "./server.js";
import { quoted } from "./text.js";

const capabilityId = z.string().min(1).describe("The id of the capability, as the plan shows it");
/** What a claim is on: a capability or an increment, exactly one. */
const part = {
  capability: capabilityId.optional(),
  increment: z.string().min(1).optional().describe("The id of the increment, as the plan shows it: claiming one starts it"),
};
const ONE_PART = "Name a capability or an increment to claim, exactly one.";

export function registerClaimTools(define: Define, extensions: readonly ToolExtension[] = []): void {
  define(
    "claim",
    "Claim a capability before you build it, or the increment you drive, with a one-line reason: your edits then count toward it, and claiming an increment starts it. If another live session holds it you are told who, and if it waits on other work you are told what; either way, pick other work.",
    z.object({ ...part, reason: z.string().min(1).describe("One line: what you are about to do") }),
    async ({ capability, increment, reason }, call) => {
      const id = capability ?? increment;
      if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true, data: { held: false } };
      const answer = await claim(claimContext(call), id, reason);
      if (!answer.ok) return { text: await refusalText(call.library, id, answer), refused: true, data: { held: false } };
      const name = await titleOf(call.library, id);
      const taken = answer.takenOverFrom === undefined ? "" : ` You took it over from ${holderOf(answer.takenOverFrom)}, who had gone quiet.`;
      const next =
        increment === undefined
          ? "Write each contract's failing test and report it red, make it pass and report it green, then land it."
          : "It is active now. When it is done, close it with its outcome and its pull request.";
      return { text: `You hold ${name} now.${taken} ${next}`, data: { held: true } };
    },
  );

  define(
    "make_workspace",
    "Make a claimed Claude Code workspace, or prepare a Codex app workspace: check the work is free and fetch main. For Codex, pass the returned ref and name to the app's create_worktree, then call attach_workspace with its returned folder. Refused if held, waiting or already yours; pick other work.",
    z.object({ ...part, reason: z.string().min(1).describe("One line: what you are about to do") }),
    async ({ capability, increment, reason }, call) => {
      const id = capability ?? increment;
      if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true, data: { made: false } };
      const made = await makeWorkspace(claimContext(call), id, reason);
      if (!made.ok) return { text: await workspaceRefusalText(call.library, id, made), refused: true, data: { made: false } };
      if (made.status === "prepared") {
        const { ref, name, base, status } = made;
        return {
          text: `Work is available; nothing is claimed yet. Call the Codex app's create_worktree with ${JSON.stringify({ ref, name })} (the exact commit from freshly fetched ${base}), then call attach_workspace for ${id} with its returned folder, this ref and name, and your reason. Use the returned directory explicitly: the app does not change your cwd or permissions. If it returns a worktree with a registration error, attach that directory; do not create another as a retry. If create_worktree is unavailable, continue this setup in the Codex desktop app.`,
          data: { made: false, status, ref, name, base },
        };
      }
      return {
        text: `Made a workspace at ${made.folder}, on branch ${made.branch} from ${made.base} as just fetched, and you hold ${await titleOf(call.library, id)} there. Call EnterWorktree with path ${JSON.stringify(made.folder)} to work in it, and set it up as this project does at session start (install its packages).`,
        data: { made: true, status: made.status, folder: made.folder, branch: made.branch, base: made.base },
      };
    },
  );

  define(
    "attach_workspace",
    "Attach the Codex app's returned worktree after make_workspace and the app's create_worktree. Verifies this repository and the exact prepared commit, names a detached branch codex/<name>, and claims the work. A refusal keeps the app's folder; do not recreate it.",
    z.object({
      ...part,
      reason: z.string().min(1),
      folder: z.string().min(1).describe("The directory returned by the app's create_worktree"),
      ref: z.string().min(1).describe("The exact commit returned by make_workspace and passed to create_worktree"),
      name: z.string().min(1).describe("The work-derived name returned by make_workspace"),
    }),
    async ({ capability, increment, reason, folder, ref, name }, call) => {
      const id = capability ?? increment;
      if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true, data: { attached: false } };
      const attached = await attachWorkspace(claimContext(call), id, reason, { folder, ref, name });
      if (!attached.ok) return { text: `${await workspaceRefusalText(call.library, id, attached)} The app's worktree is kept.`, refused: true, data: { attached: false } };
      return {
        text: `Attached ${attached.folder}, on branch ${attached.branch} at ${attached.base}; you hold ${await titleOf(call.library, id)} there. Use that directory explicitly for your commands and set it up as this project does at session start (install its packages).`,
        data: { attached: true, folder: attached.folder, branch: attached.branch, base: attached.base },
      };
    },
  );

  define("release", "Release a capability or an increment you hold, without landing or closing it, so another session can take it.", z.object(part), async ({ capability, increment }, call) => {
    const id = capability ?? increment;
    if (id === undefined || (capability !== undefined && increment !== undefined)) return { text: ONE_PART, refused: true };
    const answer = await release(claimContext(call), id);
    if (answer.ok) return { text: `You released ${await titleOf(call.library, id)}.` };
    return {
      text: answer.holder === undefined ? `You don't hold ${id}, and nobody else does.` : `You don't hold ${id}: ${holderOf(answer.holder)} does.`,
      refused: true,
    };
  });

  define(
    "report",
    "Report a contract's test red (written, and failing) or green (passing). Storytree keeps what you report apart from what it verifies itself.",
    z.object({
      contract: z.string().min(1).describe("The id of the contract, as the plan shows it"),
      result: z.enum(["red", "green"]).describe("red: the test is written and fails; green: it passes"),
      note: z.string().min(1).optional().describe("Anything worth saying with it"),
    }),
    async ({ contract, result, note }, call) => {
      await call.library.reportHealth(contract, result === "red" ? "failing" : "passing", {
        ...call.writer,
        by: `${call.caller.harness ?? "agent"} ${call.caller.session}`,
        ...(note === undefined ? {} : { note }),
      });
      return result === "red"
        ? { text: `Reported ${contract} red. Now make it pass and report it green.`, data: { reported: "failing" } }
        : { text: `Reported ${contract} green.`, data: { reported: "passing" } };
    },
  );

  define(
    "land",
    "Report a capability landed: its work is finished. Your claim on it ends.",
    z.object({ capability: capabilityId }),
    async ({ capability }, call) => {
      const answer = await land(claimContext(call), capability);
      if (answer.ok) {
        const next: string[] = [];
        for (const extension of extensions) {
          try {
            const line = await extension.landNext?.(capability, call);
            if (line?.trim()) next.push(line.trim());
          } catch (error) {
            // The landing is already recorded: a failed follow-up must not report it refused.
            next.push(`The next step is unavailable: ${refusalOf(error)}`);
          }
        }
        return {
          text: [`Landed ${await titleOf(call.library, capability)}. Your claim on it has ended.`, ...next.map((line) => `Next: ${line}`)].join("\n"),
          data: { landed: true, ...(next.length === 0 ? {} : { next }) },
        };
      }
      return answer.refused === "held"
        ? { text: `${await titleOf(call.library, capability)} is held by ${holderOf(answer.holder)}; only its holder lands it.`, refused: true }
        : { text: `There is no capability ${capability} in this project's plan.`, refused: true };
    },
  );
}

function claimContext({ log, library, project, caller, folder, quietMs, writer }: Call): ClaimContext & { readonly folder: string } {
  const branch = currentBranch(folder);
  return { log, library, project, ...lineOf(caller), folder, quietMs, writer, ...(branch === undefined ? {} : { branch }) };
}

/** Why a claim was refused, as the agent is told it. */
async function refusalText(library: Library, id: string, answer: Exclude<ClaimAnswer, { ok: true }>): Promise<string> {
  switch (answer.refused) {
    case "held":
      return `${await titleOf(library, id)} is held by ${holderOf(answer.holder)}. Pick other work: nobody queues.`;
    case "closed":
      return `${await titleOf(library, id)} is closed: there is nothing left to claim. Pick other work.`;
    case "waiting": {
      const waits = answer.waits.map((wait) =>
        wait.onOwner === true ? `${wait.increment} is waiting on the owner: it is held on their open question ${wait.on}` : `${wait.increment} waits on ${wait.on} (${wait.reason})${wait.forGood ? ", which will never release" : ""}`,
      );
      return `${await titleOf(library, id)} is waiting work: ${waits.join("; ")}. Pick other work until it releases.`;
    }
    case "unknown-capability":
      return `There is no capability or increment ${id} in this project's plan; plan it first, or find its id with show_plan.`;
  }
}

async function workspaceRefusalText(library: Library, id: string, answer: WorkspaceRefusal): Promise<string> {
  if (answer.refused === "yours") return `You already hold ${await titleOf(library, id)}${answer.claim.branch === undefined ? "" : `, on branch ${answer.claim.branch}`}: work there, or release it first.`;
  if (answer.refused === "no-workspace") return `Workspace setup refused: ${answer.why}.`;
  return refusalText(library, id, answer);
}

/** Who holds a claim, and why, as a sentence names them. */
function holderOf(claim: Claim): string {
  return `${claim.label} session ${claim.session} (${claim.reason})`;
}

/** A capability's or an increment's title, quoted, or its id when the plan has no such thing. */
async function titleOf(library: Library, id: string): Promise<string> {
  for (const story of (await library.projectTree()).stories) {
    const found = story.capabilities.find((node) => node.id === id);
    if (found !== undefined) return `${quoted(found.title)} (${id})`;
  }
  const increment = (await increments(library)).find((one) => one.id === id);
  return increment === undefined ? id : `${quoted(increment.fields.title)} (${id})`;
}
