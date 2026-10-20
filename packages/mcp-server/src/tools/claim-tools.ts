/**
 * Capability 6 · Agent tools (the MCP server). The reporting tools: report a contract red or green, and report a capability
 * landed. Claiming, releasing and making a workspace are Session management's tools, mounted from its manifest. A landing
 * that would leave a source file of the capability's story package reached by no numbered test is held
 * until each is placed, through the Guardrails story's allocation rule, the code `storytree check` runs
 * (ADR-0911 D4, contract 6.37).
 */
import { allocationProblems, checkoutOf } from "@storytree/guardrails";
import type { Library } from "@storytree/library";
import { packagesOf, testedNumbers as testedNumbersIn, untestedContracts as untestedIn } from "@storytree/map/code-survey";
import { z } from "zod";

import { land } from "@storytree/session-management";
import { claimContext, holderOf, titleOf } from "@storytree/session-management/tools";
import { refusalOf } from "./answers.js";
import type { Call, Define, ToolExtension } from "./server.js";

const capabilityId = z.string().min(1).describe("The id of the capability, as the plan shows it");

export function registerClaimTools(define: Define, extensions: readonly ToolExtension[] = []): void {
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
      const unplaced = await unplacedFiles(call, capability);
      if (unplaced.length > 0) {
        return {
          text: [`${await titleOf(call.library, capability)} is not landed: its story's package has ${unplaced.length === 1 ? "a source file" : `${unplaced.length} source files`} no numbered test reaches (ADR-0911 D4). Place each, then land again; your claim stays.`, ...unplaced.map((problem) => `- ${problem}`)].join("\n"),
          refused: true,
          data: { landed: false, unplaced },
        };
      }
      // Naming the gap is an aid: a checkout the survey cannot read names none, and never stops the landing.
      const untested = await untestedContracts(call, capability).catch(() => []);
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
        const gaps = untested.length === 0 ? [] : [
          `No numbered test in its story's package proves ${untested.length === 1 ? "this planned contract" : `these ${untested.length} planned contracts`}: write each one's test ("N.M · …"), or retire the contract if it is no longer wanted.`,
          ...untested.map((title) => `- ${title}`),
        ];
        return {
          text: [`Landed ${await titleOf(call.library, capability)}. Your claim on it has ended.`, ...gaps, ...next.map((line) => `Next: ${line}`)].join("\n"),
          data: { landed: true, ...(untested.length === 0 ? {} : { untested }), ...(next.length === 0 ? {} : { next }) },
        };
      }
      return answer.refused === "held"
        ? { text: `${await titleOf(call.library, capability)} is held by ${holderOf(answer.holder)}; only its holder lands it.`, refused: true }
        : { text: `There is no capability ${capability} in this project's plan.`, refused: true };
    },
  );
}

/** The allocation problems of `capability`'s story package in the checkout the session works in; none for a capability the plan lacks. */
async function unplacedFiles({ library, folder }: Call, capability: string): Promise<string[]> {
  const story = (await library.projectTree()).stories.find((one) => one.capabilities.some((part) => part.id === capability));
  return story === undefined ? [] : allocationProblems(checkoutOf(folder), packagesOf(story));
}

/**
 * The titles of `capability`'s planned contracts that no numbered test in its story's package names, in the
 * checkout the session works in, read with the map's survey as CI health reads proofs; none for a capability
 * the plan lacks. A title prefixed with another package proves that package's contracts, not these.
 */
async function untestedContracts(call: Call, capability: string): Promise<string[]> {
  const tree = await call.library.projectTree();
  return untestedIn(tree, capability, await testedNumbers(call, capability, tree));
}

/** The contract numbers the numbered tests in `capability`'s story package carry, in the checkout the session works in. */
export async function testedNumbers({ library, folder }: Call, capability: string, tree?: Awaited<ReturnType<Library["projectTree"]>>): Promise<string[]> {
  return testedNumbersIn(checkoutOf(folder), tree ?? (await library.projectTree()), capability);
}
