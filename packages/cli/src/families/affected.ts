/** Capability 1 · Front door. Git selection and impact belong to The map; this front door only parses and prints. */
import { affectedCommand } from "@storytree/map/read";
import { Refusal } from "../answer.js";
import type { Family } from "../door.js";
import { mapOptions } from "./map.js";

export const affectedFamily: Family = {
  name: "affected",
  summary: "map a branch's changed files to the promises, dependents and tests they affect; counts first",
  verbs: [],
  bare: {
    name: "affected",
    usage: "affected [<range>|--range <range>] [--up N] [--down N] [--kind story,capability,promise,file,test] [--dry-run|--show] [--json]",
    summary: "defaults to origin/main's merge-base against the working tree, including untracked files; A..B compares commits; down limits impact hops, up follows dependencies",
    switches: ["dry-run", "show", "json"],
    async act(args, context) {
      if (args.words.length > 1 || (args.words.length > 0 && args.has("range"))) throw new Refusal(`Give one range, as a word or --range.\nusage: storytree ${this.usage}`, { code: 2 });
      const range = args.text("range") ?? (args.words[0] === undefined ? undefined : args.read(args.words[0]));
      return { text: await affectedCommand(await context.library(), context.cwd, { ...mapOptions(args), ...(range === undefined ? {} : { range }) }, args.has("json")) };
    },
  },
};
