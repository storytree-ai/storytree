/**
 * Capability 6 · Agent tools (the MCP server). What a landing is checked against, handed to Session management's land
 * tool, which reports a capability landed: claiming, releasing, reporting, landing and presenting are Session
 * management's tools, mounted from its manifest, so they switch off with it (ADR-1095). A landing is held while any claim
 * check the mounted parts contribute names a problem (ADR-1170 D2): Guardrails' allocation rule holds one that would leave
 * a source file of the capability's story package reached by no numbered test (ADR-0911 D4, contract 6.37), and with
 * Guardrails switched off it is not run (6.102). The checks read the parts and the map, so they are built here rather
 * than in Session management, which stands on neither.
 */
import type { Library } from "@storytree/library";
import { testedNumbers as testedNumbersIn, untestedContracts as untestedIn } from "@storytree/map/code-survey";

import { refusalOf } from "./answers.js";
import type { Call, ClaimCheck, Landing, ToolExtension } from "./server.js";

/** The claim checks a landing runs, and the next steps `extensions` suggest after it, read when a capability lands. */
export function landingOf(checks: () => readonly ClaimCheck[], extensions: () => readonly ToolExtension[]): Landing {
  return {
    async unplaced(capability, { library, folder }) {
      const problems = await Promise.all(checks().map((check) => check.landing(capability, { library, folder })));
      return problems.flat();
    },
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

/**
 * The titles of `capability`'s planned contracts that no numbered test in its story's package names, in the
 * checkout the session works in, read with the map's survey as CI health reads proofs; none for a capability
 * the plan lacks. A title prefixed with another package proves that package's contracts, not these.
 */
async function untestedContracts(capability: string, call: Call): Promise<string[]> {
  const tree = await call.library.projectTree();
  return untestedIn(tree, capability, await testedNumbers(call, capability, tree));
}

/** The contract numbers the numbered tests in `capability`'s story package carry, in the checkout the session works in, read against `tree`. */
export async function testedNumbers({ folder }: Call, capability: string, tree: Awaited<ReturnType<Library["projectTree"]>>): Promise<string[]> {
  // The survey reads the checkout `folder` is in, from its top.
  return testedNumbersIn(folder, tree, capability);
}
