/**
 * The claiming and reporting tools: claim or release a capability, report a contract red or green,
 * and report a capability landed.
 */
import type { Library } from "@storytree/library";
import { z } from "zod";

import { claim, currentBranch, land, release, type Claim, type ClaimContext } from "../claims/index.js";
import { lineOf, type Call, type Define } from "./server.js";
import { quoted } from "./text.js";

const capabilityId = z.string().min(1).describe("The id of the capability, as the plan shows it");

export function registerClaimTools(define: Define): void {
  define(
    "claim",
    "Claim a capability before you build it, with a one-line reason: your edits then count toward it. If another live session holds it you are told who, and should pick other work.",
    z.object({ capability: capabilityId, reason: z.string().min(1).describe("One line: what you are about to do") }),
    async ({ capability, reason }, call) => {
      const answer = await claim(claimContext(call), capability, reason);
      if (!answer.ok) {
        return answer.refused === "held"
          ? { text: `${await titleOf(call.library, capability)} is held by ${holderOf(answer.holder)}. Pick other work: nobody queues.`, refused: true, data: { held: false } }
          : { text: `There is no capability ${capability} in this project's plan; plan it first, or find its id with show_plan.`, refused: true, data: { held: false } };
      }
      const name = await titleOf(call.library, capability);
      const taken = answer.takenOverFrom === undefined ? "" : ` You took it over from ${holderOf(answer.takenOverFrom)}, who had gone quiet.`;
      return {
        text: `You hold ${name} now.${taken} Write each contract's failing test and report it red, make it pass and report it green, then land it.`,
        data: { held: true },
      };
    },
  );

  define("release", "Release a capability you hold, without landing it, so another session can take it.", z.object({ capability: capabilityId }), async ({ capability }, call) => {
    const answer = await release(claimContext(call), capability);
    if (answer.ok) return { text: `You released ${await titleOf(call.library, capability)}.` };
    return {
      text: answer.holder === undefined ? `You don't hold ${capability}, and nobody else does.` : `You don't hold ${capability}: ${holderOf(answer.holder)} does.`,
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
      if (answer.ok) return { text: `Landed ${await titleOf(call.library, capability)}. Your claim on it has ended.`, data: { landed: true } };
      return answer.refused === "held"
        ? { text: `${await titleOf(call.library, capability)} is held by ${holderOf(answer.holder)}; only its holder lands it.`, refused: true }
        : { text: `There is no capability ${capability} in this project's plan.`, refused: true };
    },
  );
}

function claimContext({ log, library, project, caller, folder, quietMs }: Call): ClaimContext {
  const branch = currentBranch(folder);
  return { log, library, project, ...lineOf(caller), folder, quietMs, ...(branch === undefined ? {} : { branch }) };
}

/** Who holds a claim, and why, as a sentence names them. */
function holderOf(claim: Claim): string {
  return `${claim.label} session ${claim.session} (${claim.reason})`;
}

/** A capability's title, quoted, or its id when the plan has no such capability. */
async function titleOf(library: Library, capability: string): Promise<string> {
  for (const story of (await library.projectTree()).stories) {
    const found = story.capabilities.find((node) => node.id === capability);
    if (found !== undefined) return `${quoted(found.title)} (${capability})`;
  }
  return capability;
}


