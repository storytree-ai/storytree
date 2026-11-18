// Capability 6 · Tool server (the MCP server)
import { refusalOf } from "./answers.js";
import { untestedOf } from "./plan-tools.js";
import type { Call, ClaimCheck, Landing, ToolExtension, ToolHost } from "./server.js";

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
          next.push(`The next step is unavailable: ${refusalOf(error)}`);
        }
      }
      return next;
    },
  };
}
