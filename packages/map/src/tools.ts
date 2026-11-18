// Capability 2 · Focus selection
import type { HealthWorkItem, Library, Storytree } from "@storytree/library";
import { z } from "zod";

import { formatCapabilityTree } from "./capability-tree.js";
import { formatFocus } from "./focus.js";
import { formatCrossing } from "./code-survey/crossings.js";
import type { ImportedFolder } from "./code-survey/read-survey.js";
import { formatLinks } from "./code-survey/links.js";
import { capabilityTreeProject, crossingProject, focusProject, healthWorklistAt, linksProject } from "./read.js";

interface ToolCall {
  readonly library: Library;
  readonly storytree: Storytree;
  readonly folder: string;
}

interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
}

export interface ToolHost {
  readonly imports: (storytree: Storytree, project: string) => Promise<readonly ImportedFolder[]>;
  readonly heldBack: (items: readonly HealthWorkItem[]) => string | undefined;
}

export const mapToolParts = [(host: ToolHost): ToolExtension => mapTools(host)];

export function mapTools({ imports: importsOf, heldBack }: ToolHost): ToolExtension {
  return {
    registerTools(define) {
      define(
        "focus",
        "Focus the project's map on file:<path>, cap:<id|number>, contract:<id|number>, or story:<name>. Up follows dependencies; down follows dependents, each to a depth. Counts are the default; dry_run estimates detail and show returns every row or refuses above the ceiling. Reads the current checkout. Give crossing (folders or file patterns in an imported island, from its import's folder, full paths, or cap:<id|number> for an imported story's capability's folders and files) to count the files outside that import files inside and the files inside that import files outside, before changing or adopting a part; select may then name an imported story to draw the line among its files only, and show lists each import. Give capabilities with select story:<name> for that story's capabilities in one read: each with its health, contracts, dependencies, and files with their lines of code. Give links with select story:<imported> to check an imported story's links against its code's imports, as storytree drew them or an agent mapped them on code storytree cannot read: each import, resolved as the drawing resolves it, between the files of two capabilities that cover files that no link covers, and each link no import backs, with the imports behind each.",
        z.object({
          select: z.string().min(1).optional(),
          crossing: z.array(z.string().min(1)).min(1).optional(),
          up: z.number().int().nonnegative().optional(),
          down: z.number().int().nonnegative().optional(),
          kind: z.array(z.enum(["story", "capability", "contract", "file", "test"])).optional(),
          mode: z.enum(["counts", "dry_run", "show"]).optional(),
          capabilities: z.boolean().optional(),
          links: z.boolean().optional(),
        }),
        async ({ select, crossing, up, down, kind, mode, capabilities, links }, { library, storytree, folder }) => {
          if (capabilities === true && (crossing !== undefined || !select?.startsWith("story:"))) throw new Error("capabilities answers for one story: select story:<name>, with no crossing.");
          if (links === true && (capabilities === true || crossing !== undefined || !/^story:./.test(select ?? ""))) throw new Error("links checks one imported story: select story:<name>, with no crossing or capabilities.");
          if (crossing === undefined && select === undefined) throw new Error("Give select, or crossing.");
          if (crossing !== undefined && select !== undefined && !/^story:./.test(select)) throw new Error("With crossing, select names an imported story: story:<name>.");
          if (crossing !== undefined && mode === "dry_run") throw new Error("A crossing answers counts or show.");
          const imports = await importsOf(storytree, library.name);
          if (links === true) {
            const answer = await linksProject(library, folder, select!, imports);
            return { text: formatLinks(answer), data: { ...answer } };
          }
          if (capabilities === true) {
            const answer = await capabilityTreeProject(library, folder, select!, imports);
            return { text: formatCapabilityTree(answer), data: { ...answer } };
          }
          if (crossing !== undefined) {
            const answer = await crossingProject(library, folder, { patterns: crossing, ...(select === undefined ? {} : { story: select.slice(6) }), ...(mode === undefined || mode === "dry_run" ? {} : { mode }) }, imports);
            return { text: formatCrossing(answer), data: { ...answer }, refused: answer.refused };
          }
          const answer = await focusProject(library, folder, {
            select: select!,
            ...(up === undefined ? {} : { up }),
            ...(down === undefined ? {} : { down }),
            ...(kind === undefined ? {} : { kind }),
            ...(mode === undefined ? {} : { mode }),
          }, imports);
          return { text: formatFocus(answer), data: { ...answer }, refused: answer.refused };
        },
      );
      define(
        "health_worklist",
        "See the oldest three capabilities that are not healthy, each with its reason, who moves it and since when, and how many more wait. One an open increment lists among its capabilities is already routed and not offered (ADR-0825 D4), and neither is one a test run in progress, or a merge to main its own-health run has not recorded yet, will record: it is held back, and counted.",
        z.object({}),
        async (_args, { library, folder }) => {
          const all = await healthWorklistAt(library, folder);
          const said = heldBack(all);
          const held = all.filter(({ waits }) => waits !== undefined).map(({ capability }) => capability);
          const listed = all.filter(({ waits }) => waits === undefined);
          if (listed.length === 0) return { text: ["Nothing waits on the health worklist: every capability is healthy or already routed.", ...(said === undefined ? [] : [said])].join("\n"), data: { items: [], more: 0, held } };
          const items = listed.slice(0, 3);
          const more = listed.length - items.length;
          const lines = items.map(({ capability, title, status, why, since, failure }) =>
            `Capability "${title}" (${capability}): ${status} — ${why.reason}, the ${why.mover}'s to move${why.contracts.length === 0 ? "" : `, carried by ${why.contracts.join(", ")}`}; since ${since.slice(0, 10)}` +
            (failure === undefined ? "" : `; its verified note: ${failure}`),
          );
          if (more > 0) lines.push(`${more} more wait.`);
          if (said !== undefined) lines.push(said);
          return { text: lines.join("\n"), data: { items, more, held } };
        },
      );
    },
  };
}
