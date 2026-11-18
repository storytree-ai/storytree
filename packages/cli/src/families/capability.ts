// Capability 10 · Plan view
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";
import { WHERE_USAGE, writtenFor } from "../mount.js";

function switching(name: "built" | "proposed"): Verb {
  return {
    name,
    usage: `capability ${name} <capability> ${WHERE_USAGE}`,
    summary: name === "built" ? "say a capability is built: it is no longer proposed" : "say a capability is proposed again",
    async act(args, context) {
      const id = args.word(0, "the capability's id", this.usage);
      const done = await (await writtenFor(args, context, this.usage)).setProposed(id, name === "proposed", context.writer());
      if (done === null) throw new Refusal(`no capability "${id}" in this project`, { next: [{ command: "storytree tree", why: "see every capability's id" }] });
      return {
        text: name === "built"
          ? `Capability ${id} (${done.fields.title}) is no longer proposed. Its word now comes from what storytree verified.`
          : `Capability ${id} (${done.fields.title}) is proposed again.`,
      };
    },
  };
}

export const capabilities: Family = {
  name: "capability",
  summary: "say whether a capability is built or still proposed",
  verbs: [switching("built"), switching("proposed")],
};
