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

export const mapFamily: Family = {
  name: "map",
  summary: "focus dependencies and dependents of a file, capability, promise or story; counts first",
  verbs: [],
  bare: {
    name: "map",
    usage: "map --select file:<path>|cap:<id|number>|promise:<id|number>|story:<name>|diff:<range> [--up N] [--down N] [--kind story,capability,promise,file,test] [--dry-run|--show] [--json]",
    summary: "up follows dependencies; down follows dependents; show refuses above 200 rows; JSON on every mode",
    switches: ["dry-run", "show", "json"],
    async act(args, context) {
      const select = args.need("select", this.usage);
      const { mapCommand } = await import("@storytree/map/read");
      return { text: await mapCommand(await context.library(), context.cwd, { select, ...mapOptions(args) }, args.has("json")) };
    },
  },
};
