/**
 * Capability 6 · Agent tools (the MCP server). What a landing is checked against, handed to Session management's land
 * tool, which reports a capability landed: claiming, releasing, reporting, landing and presenting are Session
 * management's tools, mounted from its manifest, so they switch off with it (ADR-1095). A landing is held while any claim
 * check the mounted parts contribute names a problem (ADR-1170 D2), such as the owner's dev-loop plugin's allocation
 * rule, and a part not mounted is not run (6.102). The checks read the parts and the map, so they are built here rather
 * than in Session management, which stands on neither.
 */
import type { Library } from "@storytree/library";
import { storyTests, SURVEYED_LANGUAGES, testedNumbers as testedNumbersIn, untestedContracts as untestedIn } from "@storytree/map/code-survey";

import { refusalOf } from "./answers.js";
import type { Call, ClaimCheck, Landing, ToolExtension, ToolHost } from "./server.js";

/**
 * The claim checks a landing runs, and the next steps `extensions` suggest after it, read when a capability lands;
 * `imports` gives the folders this machine imports a project from, where a mapped story's tests are read.
 */
export function landingOf(checks: () => readonly ClaimCheck[], extensions: () => readonly ToolExtension[], imports: ToolHost["imports"]): Landing {
  return {
    async unplaced(capability, { library, folder }) {
      const problems = await Promise.all(checks().map((check) => check.landing(capability, { library, folder })));
      return problems.flat();
    },
    untested: (capability, call) => untestedContracts(capability, call, imports),
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
 * checkout the session works in, read with the map's survey as CI health reads proofs, and whether that package was
 * seen there at all (unseen, every planned contract is named, none proven missing), with the languages that leave it
 * unseen when the checkout's code is only in languages the survey cannot read; none for a capability the plan
 * lacks. A title prefixed with another package proves that package's contracts, not these. A mapped story's tests are
 * read where it was imported from: the checkout itself, or a folder this machine imports.
 */
async function untestedContracts(capability: string, { folder, library, storytree, project }: Call, imports: ToolHost["imports"]): Promise<{ titles: string[]; seen: boolean; unreadable?: { languages: string[]; reads: readonly string[] } }> {
  const tree = await library.projectTree();
  // The survey reads the checkout `folder` is in, from its top.
  const { numbers, seen, unreadable } = await storyTests(folder, tree, capability, { imports: await imports(storytree, project) });
  return { titles: untestedIn(tree, capability, numbers), seen, ...(unreadable === undefined ? {} : { unreadable: { languages: unreadable, reads: SURVEYED_LANGUAGES } }) };
}

/** The contract numbers the numbered tests in `capability`'s story package carry, in the checkout the session works in, read against `tree`. */
export async function testedNumbers({ folder }: Call, capability: string, tree: Awaited<ReturnType<Library["projectTree"]>>): Promise<string[]> {
  // The survey reads the checkout `folder` is in, from its top.
  return testedNumbersIn(folder, tree, capability);
}
