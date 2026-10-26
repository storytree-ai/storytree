/**
 * Capability 10 · Plan view (the command line story): `storytree contract show <contract>` prints one contract, its
 * capability and description, with its two health columns, what the agent reported and what storytree verified, each
 * with who wrote it, when and its note. Agents typed `storytree contract` most often on their way to plan one or to read
 * one's health (friction_896be858baa5), so `contract new` and `contract health` are pointed to the commands for those
 * jobs (./index.ts's POINTERS), and the family's help names both.
 */
import type { HealthColumn } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const show: Verb = {
  name: "show",
  usage: "contract show <contract>",
  summary: "one contract, its capability and description, with its reported and verified health",
  async act(args, context) {
    const id = args.word(0, "the contract's id", this.usage);
    const library = await context.library();
    const contract = await library.get(id);
    if (contract?.type !== "contract") throw new Refusal(`no contract "${id}" in this project`, { next: [{ command: "storytree tree", why: "see every contract's id" }] });
    const fields = contract.fields as { title: string; capability: string; description?: string };
    const [capability, health] = await Promise.all([library.get(fields.capability), library.health(id)]);
    const title = (capability?.fields as { title?: string } | undefined)?.title;
    return {
      text: [
        `${fields.title}  [${id}]`,
        `capability: ${title === undefined ? "" : `${title}  `}[${fields.capability}]`,
        ...(fields.description === undefined ? [] : [fields.description]),
        `reported: ${said(health.reported)}`,
        `verified: ${said(health.verified)}`,
      ].join("\n"),
    };
  },
};

/** One health column as a line: its state, then who wrote it, when and its note, each when it has one. */
function said(column: HealthColumn): string {
  const state = column.state === "not-checked" ? "not checked" : column.state;
  const by = [state, ...(column.by === undefined ? [] : [`by ${column.by}`]), ...(column.at === undefined ? [] : [column.at])].join(", ");
  return column.note === undefined ? by : `${by}: ${column.note}`;
}

export const contracts: Family = {
  name: "contract",
  summary: "read one contract with its health; storytree contract new runs storytree library new contract, and contract health runs contract show",
  verbs: [show],
};
