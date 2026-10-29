/**
 * Capability 10 · Plan view (the command line story): `storytree contract show <contract>` prints one contract, its
 * capability and description, with its two health columns, what the agent reported and what storytree verified, each
 * with who wrote it, when and its note. Agents typed `storytree contract` most often on their way to plan one or to read
 * one's health (friction_896be858baa5), so `contract new` and `contract health` are pointed to the commands for those
 * jobs (./index.ts's POINTERS), and the family's help names both. `storytree contract list [<story|capability>]` lists
 * contracts under their capabilities, every story's or one story's or capability's, by id or title, since agents typed
 * it on their way to a story's contracts (friction_2d5163d338d3).
 */
import type { HealthColumn } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";
import { healthOf } from "./tree.js";

const list: Verb = {
  name: "list",
  usage: "contract list [<story|capability>]",
  summary: "contracts under their capabilities, with each one's reported and verified health",
  async act(args, context) {
    const named = args.words[0];
    const plan = await (await context.library()).projectTree();
    const matches = (part: { id: string; title: string }): boolean => named === undefined || part.id === named || part.title.toLowerCase() === named.toLowerCase();
    const capabilities = plan.stories.flatMap((story) => (matches(story) ? story.capabilities : story.capabilities.filter(matches)));
    if (named !== undefined && capabilities.length === 0) {
      throw new Refusal(`no story or capability "${named}" in this project`, { next: [{ command: "storytree tree", why: "every story and capability" }] });
    }
    const lines = capabilities.flatMap((capability) => [
      `${capability.title}  [${capability.id}]`,
      ...capability.contracts.map((contract) => `  - ${contract.title}  [${contract.id}]  ${healthOf(contract.health, plan.unverified === true)}`),
    ]);
    if (!capabilities.some((capability) => capability.contracts.length > 0)) return { text: [...lines, "No contracts yet."].join("\n"), next: [{ command: "storytree library new contract --capability <capability> --title <title>", why: "plan one" }] };
    return { text: lines.join("\n"), next: [{ command: "storytree contract show <contract>", why: "one contract's health in full" }] };
  },
};

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
  summary: "list contracts, or read one with its health; storytree contract new runs storytree library new contract, and contract health runs contract show",
  verbs: [list, show],
};
