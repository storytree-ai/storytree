// Capability 10 · Plan view
import type { EdgeNode, NodeHealth } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

export function healthOf(health: NodeHealth, unverified: boolean): string {
  const words = (state: string): string => state.replace("-", " ");
  const reported = `agent says ${words(health.reported.state)}`;
  return unverified ? reported : `${reported} · storytree verified ${words(health.verified.state)}`;
}

export function edgeLabel(id: string, from: string, to: string): string {
  return `edge: ${from} › ${to}  [${id}]`;
}

export async function edgeContracts(
  library: { health(id: string): Promise<NodeHealth> },
  edge: Pick<EdgeNode, "contracts">,
): Promise<{ id: string; title: string; health: NodeHealth }[]> {
  return Promise.all(edge.contracts.map(async (contract) => ({ id: contract.id, title: contract.title, health: await library.health(contract.id) })));
}

export function storyEdgeLabel(story: { readonly capabilities: readonly { readonly id: string; readonly title: string }[] }, edge: Pick<EdgeNode, "id" | "from" | "to">): string {
  const title = (id: string): string => story.capabilities.find((capability) => capability.id === id)!.title;
  return edgeLabel(edge.id, title(edge.from), title(edge.to));
}

type Claim = { readonly label: string; readonly holder: "live" | "idle"; readonly reason: string; readonly increment?: string | undefined; readonly capability?: string | undefined };

function claimOn(claims: readonly Claim[], id: string): string {
  const claim = claims.find((held) => held.capability === id || held.increment === id);
  return claim === undefined ? "" : `  ⟵ ${claim.label} (${claim.holder}): ${claim.reason}`;
}

function numbersTaken(titles: readonly string[]): string {
  const numbers = titles.flatMap((title) => /^(\d+) · /.exec(title)?.[1] ?? []).map(Number).sort((a, b) => a - b);
  const unnumbered = titles.length - numbers.length;
  return `  capability numbers taken: ${numbers.length === 0 ? "none" : numbers.join(", ")}${unnumbered === 0 ? "" : ` · ${unnumbered} unnumbered`}`;
}

const view: Verb = {
  name: "tree",
  usage: "tree [<story>]",
  summary: "stories, capabilities and contracts, with the agent's reported health and any claim",
  async act(args, context) {
    const named = args.words[0];
    const library = await context.library();
    const plan = await library.projectTree();
    const stories = named === undefined ? plan.stories : plan.stories.filter((story) => story.id === named || story.title.toLowerCase() === named.toLowerCase());
    if (named !== undefined && stories.length === 0) {
      throw new Refusal(`no story "${named}" in this project`, { next: [{ command: "storytree tree", why: "every story" }] });
    }
    if (stories.length === 0) return { text: "No stories yet.", next: [{ command: "storytree library new story --title <title>", why: "add one" }] };
    const claims = await context.claims();
    const { NOT_VERIFIED, wordAndWhy } = await import("@storytree/library");
    const lines: string[] = [];
    const unverified = plan.unverified === true;
    for (const story of stories) {
      lines.push(`${story.title}  [${story.id}]  ${story.mapped === undefined ? healthOf(story.health, unverified) : "imported: here before storytree, and assumed to be working"}`);
      if (story.capabilities.length > 0) lines.push(numbersTaken(story.capabilities.map((capability) => capability.title)));
      story.capabilities.forEach((capability) => {
        lines.push(`  ${capability.title}  [${capability.id}]  ${healthOf(capability.health, unverified)}; ${capability.reportOnly ? NOT_VERIFIED : wordAndWhy(capability)}${claimOn(claims, capability.id)}`);
        for (const contract of capability.contracts) {
          lines.push(`      - ${contract.title}  [${contract.id}]  ${healthOf(contract.health, unverified)}`);
        }
      });
      for (const edge of story.edges ?? []) {
        lines.push(`  ${storyEdgeLabel(story, edge)}`);
        for (const contract of await edgeContracts(library, edge)) lines.push(`      - ${contract.title}  [${contract.id}]  ${healthOf(contract.health, unverified)}`);
      }
    }
    return { text: lines.join("\n") };
  },
};

export const tree: Family = {
  name: "tree",
  summary: "the plan as a tree, with each part's reported health",
  verbs: [],
  bare: view,
};
