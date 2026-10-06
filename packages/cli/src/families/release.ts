/** Capability 1 · Front door. The app story owns promotion; this front door only parses the owner's selected version. */
import { pinRelease } from "@storytree/app";
import type { Family, Verb } from "../door.js";
import { Refusal } from "../answer.js";

const pin: Verb = {
  name: "pin",
  usage: "release pin <0.3.n> [--preview]",
  summary: "pin the owner's chosen published build as stable, or preview its landed-increment notes",
  switches: ["preview"],
  async act(args, context) {
    const version = args.word(0, "the owner's chosen release", this.usage);
    if (args.words.length !== 1 || args.names.some(name => name !== "preview")) throw new Refusal(`usage: storytree ${this.usage}`, { code: 2 });
    const preview = args.has("preview");
    const pin = await pinRelease(version, { cwd: context.cwd, library: await context.library(), preview });
    return { text: `${preview ? "Preview of" : "Stable is pinned to"} storytree ${pin.version}. ${preview ? "Nothing was published." : "The original installer is unchanged."}\n\n${pin.releaseNotes}` };
  },
};

export const releaseFamily: Family = { name: "release", summary: "pin the owner's chosen existing build for stable installations", verbs: [pin] };
