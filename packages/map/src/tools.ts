/**
 * Capability 2 · Focus selection: the map's tools on the MCP server's one server, named in its manifest (ADR-1021), so
 * switching the map off takes them with it (ADR-1095): `focus`, with its crossing, and `health_worklist`. The extension's
 * shape is restated rather than imported, as quality assurance's is: no story may depend on the MCP server, which
 * depends on this package to serve the tools, and checks the two still fit where it mounts its tool parts (its 6.75).
 */
import type { HealthWorkItem, Library, Storytree } from "@storytree/library";
import { z } from "zod";

import { formatFocus } from "./focus.js";
import { formatCrossing } from "./code-survey/crossings.js";
import type { ImportedFolder } from "./code-survey/read-survey.js";
import { crossingProject, focusProject, healthWorklistAt } from "./read.js";

/** What a tool has for one call, of what the server hands it. */
interface ToolCall {
  readonly library: Library;
  readonly storytree: Storytree;
  /** The folder the agent works in: the checkout the map reads. */
  readonly folder: string;
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

/** Registers one tool: its name, what it is for, its arguments and what it does with them. */
type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

/** The map's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
}

/**
 * What the part is given: the core's readings its tools use. The map does not install the library or Project and caller,
 * which the storytree check's slim install of the map must leave out (App setup's 11.4), so the server hands them over.
 */
export interface ToolHost {
  /** The folders this machine imports for `project`, where the map reads the mapped stories (ADR-0993 D2). */
  readonly imports: (storytree: Storytree, project: string) => Promise<readonly ImportedFolder[]>;
  /** What the worklist says of the capabilities a test run holds back, as the library words it. */
  readonly heldBack: (items: readonly HealthWorkItem[]) => string | undefined;
}

/** The map's tool part, named in its manifest (ADR-1021): served for every project's library. */
export const mapToolParts = [(host: ToolHost): ToolExtension => mapTools(host)];

/** The tools the map serves: focus and its crossing, and the health worklist. */
export function mapTools({ imports: importsOf, heldBack }: ToolHost): ToolExtension {
  return {
    registerTools(define) {
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
          if (crossing === undefined && select === undefined) throw new Error("Give select, or crossing.");
          if (crossing !== undefined && select !== undefined && !/^story:./.test(select)) throw new Error("With crossing, select names a mapped story: story:<name>.");
          if (crossing !== undefined && mode === "dry_run") throw new Error("A crossing answers counts or show.");
          const imports = await importsOf(storytree, library.name);
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
          const lines = items.map(({ capability, title, status, why, since }) =>
            `Capability "${title}" (${capability}): ${status} — ${why.reason}, the ${why.mover}'s to move${why.contracts.length === 0 ? "" : `, carried by ${why.contracts.join(", ")}`}; since ${since.slice(0, 10)}`,
          );
          if (more > 0) lines.push(`${more} more wait.`);
          if (said !== undefined) lines.push(said);
          return { text: lines.join("\n"), data: { items, more, held } };
        },
      );
    },
  };
}
