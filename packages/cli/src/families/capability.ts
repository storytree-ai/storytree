/**
 * Capability 10 · Plan view (the command line story): `storytree capability built <capability>`
 * switches a capability's proposed flag off once the agent considers it built, and
 * `storytree capability proposed <capability>` switches it back on (ADR-0744 D2). Switching it off
 * makes nothing healthy: the card's word then comes from storytree's verified column. Both call the
 * library's one setProposed, which records the writer like any edit.
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

function switching(name: "built" | "proposed"): Verb {
  return {
    name,
    usage: `capability ${name} <capability>`,
    summary: name === "built" ? "say a capability is built: it is no longer proposed" : "say a capability is proposed again",
    async act(args, context) {
      const id = args.word(0, "the capability's id", this.usage);
      const done = await (await context.library()).setProposed(id, name === "proposed", context.writer());
      if (done === null) throw new Refusal(`no capability "${id}" in this project`, { next: [{ command: "storytree tree", why: "see every capability's id" }] });
      return {
        text: name === "built"
          ? `Capability ${id} (${done.fields.title}) is no longer proposed. Its word now comes from what storytree verified.`
          : `Capability ${id} (${done.fields.title}) is proposed again.`,
        next: [{ command: "storytree tree", why: "see the plan" }],
      };
    },
  };
}

export const capabilities: Family = {
  name: "capability",
  summary: "say whether a capability is built or still proposed",
  verbs: [switching("built"), switching("proposed")],
};
