/**
 * Capability 6 · Agent tools (the MCP server). What a landing is checked against, handed to Session management's land
 * tool, which reports a capability landed: claiming, releasing, reporting, landing and presenting are Session
 * management's tools, mounted from its manifest, so they switch off with it (ADR-1095). A landing that would leave a source
 * file of the capability's story package reached by no numbered test is held until each is placed, through the Guardrails
 * story's allocation rule, the code `storytree check` runs (ADR-0911 D4, contract 6.37). The checks read Guardrails and the
 * map, so they are built here rather than in Session management, which stands on neither.
 */
import { allocationProblems, checkoutOf } from "@storytree/guardrails";
import type { Library } from "@storytree/library";
import { packagesOf, testedNumbers as testedNumbersIn, untestedContracts as untestedIn } from "@storytree/map/code-survey";

import { refusalOf } from "./answers.js";
import type { Call, Landing, ToolExtension } from "./server.js";

/** The checks a landing runs, and the next steps `extensions` suggest after it, read when a capability lands. */
export function landingOf(extensions: () => readonly ToolExtension[]): Landing {
  return {
    unplaced: unplacedFiles,
    untested: untestedContracts,
    async next(capability, call) {
      const next: string[] = [];
      for (const extension of extensions()) {
        try {
          const line = await extension.landNext?.(capability, call);
          if (line?.trim()) next.push(line.trim());
        } catch (error) {
          // The landing is already recorded: a failed follow-up must not report it refused.
          next.push(`The next step is unavailable: ${refusalOf(error)}`);
        }
      }
      return next;
    },
  };
}

/** The allocation problems of `capability`'s story package in the checkout the session works in; none for a capability the plan lacks. */
async function unplacedFiles(capability: string, { library, folder }: Call): Promise<string[]> {
  const story = (await library.projectTree()).stories.find((one) => one.capabilities.some((part) => part.id === capability));
  return story === undefined ? [] : allocationProblems(checkoutOf(folder), packagesOf(story));
}

/**
 * The titles of `capability`'s planned contracts that no numbered test in its story's package names, in the
 * checkout the session works in, read with the map's survey as CI health reads proofs; none for a capability
 * the plan lacks. A title prefixed with another package proves that package's contracts, not these.
 */
async function untestedContracts(capability: string, call: Call): Promise<string[]> {
  const tree = await call.library.projectTree();
  return untestedIn(tree, capability, await testedNumbers(call, capability, tree));
}

/** The contract numbers the numbered tests in `capability`'s story package carry, in the checkout the session works in. */
export async function testedNumbers({ library, folder }: Call, capability: string, tree?: Awaited<ReturnType<Library["projectTree"]>>): Promise<string[]> {
  return testedNumbersIn(checkoutOf(folder), tree ?? (await library.projectTree()), capability);
}
