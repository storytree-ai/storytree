/**
 * Capability 10 · Plan view (the command line story): `storytree contract show <contract>` prints one contract, its
 * capability and description, with its two health columns, what the agent reported and what storytree verified, each
 * with who wrote it, when and its note. Agents typed `storytree contract` most often on their way to plan one or to read
 * one's health (friction_896be858baa5), so `contract new` and `contract health` are pointed to the commands for those
 * jobs (./index.ts's POINTERS), and the family's help names both. `storytree contract list [<story|capability>]` lists
 * contracts under their capabilities, every story's or one story's or capability's, by id or title, since agents typed
 * it on their way to a story's contracts (friction_2d5163d338d3); a story's list ends with its edges' contracts under their
 * edges, and `contract show` of an edge's contract names its edge, from › to, where another names its capability
 * (ADR-1282 D1). Each verb refuses a flag it does not read before it
 * opens the library, so a mistyped narrowing (`contract list --capability <id>`) is never answered with every contract
 * (friction_3bb49532533f).
 */
import type { HealthColumn, NodeHealth } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Args } from "../args.js";
import type { Family, Verb } from "../door.js";
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
      // A live edge's ends are live: the library refuses to retire a capability an edge depends on.
      const [from, to] = await Promise.all([titleOf(ends.from), titleOf(ends.to)]);
      return edgeLabel(edge, from!, to!);
    }
  },
};

/**
 * `storytree contract report`, the report tool's twin (ADR-0793): a session whose agent link dropped records a contract's
 * test red or green from its shell (friction_42f65edd6dcc). It reads its words and hands them to Session management's
 * reportContract, the work the tool does, so both doors write the same entry and are refused the same way. The shell's
 * harness session reports it, or else the person at the terminal.
 */
const report: Verb = {
  name: "report",
  usage: "contract report <contract> --result red|green [--note <text|@file>]",
  summary: "record a contract's test red (written, and failing) or green (passing), as the report tool does",
  async act(args, context) {
    reads(args, ["result", "note"], this.usage);
    const contract = args.word(0, "the contract's id", this.usage);
    const result = args.need("result", this.usage);
    if (result !== "red" && result !== "green") throw new Refusal(`--result is red or green, not "${result}"\nusage: storytree ${this.usage}`, { code: 2 });
    const note = args.text("note");
    const [{ reportContract }, library] = await Promise.all([import("@storytree/session-management/tools"), context.library()]);
    const caller = commandSession() ?? { session: person(), harness: "person" };
    const answer = await reportContract(library, { contract, result, ...(note === undefined ? {} : { note }) }, { writer: context.writer(), ...caller });
    return { text: answer.text, next: [{ command: `storytree contract show ${contract}`, why: "read its health back" }] };
  },
};

/** Refuse the first flag given that is not one of `taken`, naming it, then `instead` when there is one, then the usage. */
function reads(args: Args, taken: readonly string[], usage: string, instead?: string): void {
  const stray = args.names.find((name) => !taken.includes(name));
  if (stray === undefined) return;
  throw new Refusal([`--${stray} is not a flag storytree ${usage.split(" ").slice(0, 2).join(" ")} reads`, ...(instead === undefined ? [] : [instead]), `usage: storytree ${usage}`].join("\n"), { code: 2 });
}

/** One health column as a line: its state, then who wrote it, when and its note, each when it has one. */
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
