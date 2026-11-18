// Capability 10 · Plan view
import type { HealthColumn, NodeHealth } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Args } from "../args.js";
import type { Family, Verb } from "../door.js";
import { WHERE_USAGE, writtenFor } from "../mount.js";
import { commandSession, person } from "../writer.js";
import { edgeContracts, edgeLabel, healthOf, storyEdgeLabel } from "./tree.js";

const list: Verb = {
  name: "list",
  usage: "contract list [<story|capability>]",
  summary: "contracts under their capabilities, with each one's reported and verified health",
  async act(args, context) {
    reads(args, [], this.usage, "name the story or capability instead: storytree contract list <story|capability>");
    const named = args.words[0];
    const library = await context.library();
    const plan = await library.projectTree();
    const matches = (part: { id: string; title: string }): boolean => named === undefined || part.id === named || part.title.toLowerCase() === named.toLowerCase();
    const capabilities = plan.stories.flatMap((story) => (matches(story) ? story.capabilities : story.capabilities.filter(matches)));
    if (named !== undefined && capabilities.length === 0) {
      throw new Refusal(`no story or capability "${named}" in this project`, { next: [{ command: "storytree tree", why: "every story and capability" }] });
    }
    const edges = await Promise.all(
      plan.stories.filter(matches).flatMap((story) => (story.edges ?? []).map(async (edge) => ({ head: storyEdgeLabel(story, edge), contracts: await edgeContracts(library, edge) }))),
    );
    const line = (contract: { title: string; id: string; health: NodeHealth }): string => `  - ${contract.title}  [${contract.id}]  ${healthOf(contract.health, plan.unverified === true)}`;
    const lines = [
      ...capabilities.flatMap((capability) => [`${capability.title}  [${capability.id}]`, ...capability.contracts.map(line)]),
      ...edges.flatMap((edge) => [edge.head, ...edge.contracts.map(line)]),
    ];
    if (![...capabilities, ...edges].some((owner) => owner.contracts.length > 0)) return { text: [...lines, "No contracts yet."].join("\n"), next: [{ command: "storytree library new contract --capability <capability> --title <title>", why: "plan one" }] };
    return { text: lines.join("\n"), next: [{ command: "storytree contract show <contract>", why: "one contract's health in full" }] };
  },
};

const show: Verb = {
  name: "show",
  usage: "contract show <contract>",
  summary: "one contract, its capability and description, with its reported and verified health",
  async act(args, context) {
    reads(args, [], this.usage);
    const id = args.word(0, "the contract's id", this.usage);
    const library = await context.library();
    const contract = await library.get(id);
    if (contract?.type !== "contract") throw new Refusal(`no contract "${id}" in this project`, { next: [{ command: "storytree tree", why: "see every contract's id" }] });
    const fields = contract.fields as { title: string; capability?: string; edge?: string; description?: string };
    const titleOf = async (part: string): Promise<string | undefined> => ((await library.get(part))?.fields as { title?: string } | undefined)?.title;
    const [owner, health] = await Promise.all([fields.capability === undefined ? edgeOf(fields.edge!) : capabilityOf(fields.capability), library.health(id)]);
    return {
      text: [
        `${fields.title}  [${id}]`,
        owner,
        ...(fields.description === undefined ? [] : [fields.description]),
        `reported: ${said(health.reported)}`,
        `verified: ${said(health.verified)}`,
      ].join("\n"),
    };

    async function capabilityOf(capability: string): Promise<string> {
      const title = await titleOf(capability);
      return `capability: ${title === undefined ? "" : `${title}  `}[${capability}]`;
    }

    async function edgeOf(edge: string): Promise<string> {
      const ends = (await library.get(edge))?.fields as { from: string; to: string } | undefined;
      if (ends === undefined) return `edge: [${edge}]`;
      const [from, to] = await Promise.all([titleOf(ends.from), titleOf(ends.to)]);
      return edgeLabel(edge, from!, to!);
    }
  },
};

const report: Verb = {
  name: "report",
  usage: `contract report <contract> --result red|green [--note <text|@file>] ${WHERE_USAGE}`,
  summary: "record a contract's test red (written, and failing) or green (passing), as the report tool does",
  async act(args, context) {
    reads(args, ["result", "note", "project", "arc", "increment"], this.usage);
    const contract = args.word(0, "the contract's id", this.usage);
    const result = args.need("result", this.usage);
    if (result !== "red" && result !== "green") throw new Refusal(`--result is red or green, not "${result}"\nusage: storytree ${this.usage}`, { code: 2 });
    const note = args.text("note");
    const [{ reportContract }, library] = await Promise.all([import("@storytree/session-management/tools"), writtenFor(args, context, this.usage)]);
    const caller = commandSession() ?? { session: person(), harness: "person" };
    const answer = await reportContract(library, { contract, result, ...(note === undefined ? {} : { note }) }, { writer: context.writer(), ...caller });
    return { text: answer.text, next: [{ command: `storytree contract show ${contract}`, why: "read its health back" }] };
  },
};

function reads(args: Args, taken: readonly string[], usage: string, instead?: string): void {
  const stray = args.names.find((name) => !taken.includes(name));
  if (stray === undefined) return;
  throw new Refusal([`--${stray} is not a flag storytree ${usage.split(" ").slice(0, 2).join(" ")} reads`, ...(instead === undefined ? [] : [instead]), `usage: storytree ${usage}`].join("\n"), { code: 2 });
}

function said(column: HealthColumn): string {
  const state = column.state === "not-checked" ? "not checked" : column.state;
  const by = [state, ...(column.by === undefined ? [] : [`by ${column.by}`]), ...(column.at === undefined ? [] : [column.at])].join(", ");
  return column.note === undefined ? by : `${by}: ${column.note}`;
}

export const contracts: Family = {
  name: "contract",
  summary: "list contracts, read one with its health, or report its test red or green; storytree contract new runs storytree library new contract, and contract health runs contract show",
  verbs: [list, show, report],
};
