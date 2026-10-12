/** Capability 1 · Front door. The map owns selection and answers; this front door only parses and prints. */
import type { FocusOptions, NodeKind } from "@storytree/map";
import type { Args } from "../args.js";
import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

export function mapOptions(args: Args): Omit<FocusOptions, "select"> {
  if (args.has("show") && args.has("dry-run")) throw new Refusal("Use either --show or --dry-run.", { code: 2 });
  const up = args.text("up");
  const down = args.text("down");
  const kind = args.text("kind");
  return {
    ...(up === undefined ? {} : { up: Number(up) }),
    ...(down === undefined ? {} : { down: Number(down) }),
    ...(kind === undefined ? {} : { kind: kind.split(",").map(value => value.trim()) as NodeKind[] }),
    mode: args.has("show") ? "show" : args.has("dry-run") ? "dry_run" : "counts",
  };
}

/** The patterns a line is drawn round, comma-separated. */
function crossingPatterns(text: string): string[] {
  const patterns = text.split(",").map(value => value.trim()).filter(value => value !== "");
  if (patterns.length === 0) throw new Refusal("Name the folders, file patterns or explored capabilities: --crossing <pattern|cap:<id|number>,...>.", { code: 2 });
  return patterns;
}

/** A crossing's line is narrowed only to a mapped story: --select story:<name>. */
function crossingStory(select: string | undefined): { story?: string } {
  if (select === undefined) return {};
  if (!select.startsWith("story:") || select.length === 6) throw new Refusal("With --crossing, --select names a mapped story: story:<name>.", { code: 2 });
  return { story: select.slice(6) };
}

export const mapFamily: Family = {
  name: "map",
  summary: "focus dependencies and dependents of a file, capability, promise or story; counts first",
  verbs: [],
  bare: {
    name: "map",
    usage: "map --select file:<path>|cap:<id|number>|promise:<id|number>|story:<name>|diff:<range> [--up N] [--down N] [--kind story,capability,promise,file,test] [--dry-run|--show] [--json], or map --crossing <folder|pattern|cap:<id|number>,...> [--select story:<mapped>] [--show] [--json]",
    summary: "up follows dependencies; down follows dependents; --crossing counts the imports across a line in a mapped island; show refuses above 200 rows; JSON on every mode",
    switches: ["dry-run", "show", "json"],
    async act(args, context) {
      const crossing = args.text("crossing");
      const select = crossing === undefined ? args.need("select", this.usage) : args.text("select");
      const { crossingCommand, mapCommand } = await import("@storytree/map/read");
      const { importsOf, machineOf, storytreeHome } = await import("@storytree/session-management");
      const library = await context.library();
      // The folders this machine imports, where the map reads the mapped stories (ADR-0993 D2).
      const imports = await importsOf(await context.server(), library.name, machineOf(storytreeHome()).id);
      if (crossing !== undefined) {
        return { text: await crossingCommand(library, context.cwd, { patterns: crossingPatterns(crossing), ...crossingStory(select), mode: args.has("show") ? "show" : "counts" }, args.has("json"), imports) };
      }
      return { text: await mapCommand(library, context.cwd, { select: select!, ...mapOptions(args) }, args.has("json"), imports) };
    },
  },
};
