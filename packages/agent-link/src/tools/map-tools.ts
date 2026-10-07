/** Capability 6 · Agent tools (the MCP server). The agent front door for The map; its selection, graph and responses stay in the map package. */
import { formatFocus } from "@storytree/map";
import { focusProject } from "@storytree/map/read";
import { z } from "zod";
import type { Define } from "./server.js";

export function registerMapTools(define: Define): void {
  define(
    "focus",
    "Focus the project's map on file:<path>, cap:<id|number>, promise:<id|number>, or story:<name>. Up follows dependencies; down follows dependents, each to a depth. Counts are the default; dry_run estimates detail and show returns every row or refuses above the ceiling. Reads the current checkout.",
    z.object({
      select: z.string().min(1),
      up: z.number().int().nonnegative().optional(),
      down: z.number().int().nonnegative().optional(),
      kind: z.array(z.enum(["story", "capability", "promise", "file", "test"])).optional(),
      mode: z.enum(["counts", "dry_run", "show"]).optional(),
    }),
    async ({ select, up, down, kind, mode }, { library, folder }) => {
      const answer = await focusProject(library, folder, {
        select,
        ...(up === undefined ? {} : { up }),
        ...(down === undefined ? {} : { down }),
        ...(kind === undefined ? {} : { kind }),
        ...(mode === undefined ? {} : { mode }),
      });
      return { text: formatFocus(answer), data: { ...answer }, refused: answer.refused };
    },
  );
}
