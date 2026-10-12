/** Capability 6 · Agent tools (the MCP server). The agent front door for The map; its selection, graph and responses stay in the map package. */
import { formatFocus } from "@storytree/map";
import { crossingProject, focusProject, formatCrossing } from "@storytree/map/read";
import { importsOf, machineOf, storytreeHome } from "@storytree/session-management";
import { z } from "zod";
import type { Define } from "./server.js";

export function registerMapTools(define: Define): void {
  define(
    "focus",
    "Focus the project's map on file:<path>, cap:<id|number>, promise:<id|number>, or story:<name>. Up follows dependencies; down follows dependents, each to a depth. Counts are the default; dry_run estimates detail and show returns every row or refuses above the ceiling. Reads the current checkout. Give crossing (folders or file patterns in a mapped island, from its import's folder, full paths, or cap:<id|number> for an explored capability's folders and files) to count the files outside that import files inside and the files inside that import files outside, before changing or adopting a part; select may then name a mapped story to draw the line among its files only, and show lists each import.",
    z.object({
      select: z.string().min(1).optional(),
      crossing: z.array(z.string().min(1)).min(1).optional(),
      up: z.number().int().nonnegative().optional(),
      down: z.number().int().nonnegative().optional(),
      kind: z.array(z.enum(["story", "capability", "promise", "file", "test"])).optional(),
      mode: z.enum(["counts", "dry_run", "show"]).optional(),
    }),
    async ({ select, crossing, up, down, kind, mode }, { library, storytree, folder }) => {
      // The folders this machine imports, where the map reads the mapped stories (ADR-0993 D2).
      const imports = await importsOf(storytree, library.name, machineOf(storytreeHome()).id);
      if (crossing !== undefined) {
        if (select !== undefined && !/^story:./.test(select)) throw new Error("With crossing, select names a mapped story: story:<name>.");
        if (mode === "dry_run") throw new Error("A crossing answers counts or show.");
        const answer = await crossingProject(library, folder, { patterns: crossing, ...(select === undefined ? {} : { story: select.slice(6) }), ...(mode === undefined ? {} : { mode }) }, imports);
        return { text: formatCrossing(answer), data: { ...answer }, refused: answer.refused };
      }
      if (select === undefined) throw new Error("Give select, or crossing.");
      const answer = await focusProject(library, folder, {
        select,
        ...(up === undefined ? {} : { up }),
        ...(down === undefined ? {} : { down }),
        ...(kind === undefined ? {} : { kind }),
        ...(mode === undefined ? {} : { mode }),
      }, imports);
      return { text: formatFocus(answer), data: { ...answer }, refused: answer.refused };
    },
  );
}
