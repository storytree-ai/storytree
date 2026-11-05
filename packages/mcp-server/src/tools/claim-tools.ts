/**
 * Capability 6 · Tool server (the MCP server). What a landing is checked against, handed to Session management's land
 * tool, which reports a capability landed: claiming, releasing, reporting, landing and presenting are Session
 * management's tools, mounted from its manifest, so they switch off with it (ADR-1095). A landing is held while any claim
 * check the mounted parts contribute names a problem (ADR-1170 D2), such as the owner's dev-loop plugin's allocation
 * rule, and a part not mounted is not run (6.102). The checks read the parts and the map, so they are built here rather
 * than in Session management, which stands on neither.
 */
import { refusalOf } from "./answers.js";
import { untestedOf } from "./plan-tools.js";
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
    untested: (capability, call) => untestedOf(capability, call, imports),
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
