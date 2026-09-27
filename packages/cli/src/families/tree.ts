/**
 * Capability 10 · Plan view (stories/cli.md): `storytree tree` prints the plan as an indented
 * tree: stories, capabilities and contracts, each with the health its agent reported (labelled as
 * the agent's) and any claim on it. Name a story to see only that story.
 *
 * One reading of the library's projectTree, whose health is already rolled up by the library, and
 * one of the agent link's claims. A story is named by its id or its title.
 */
import type { Claim } from "@storytree/agent-link";
import type { NodeHealth } from "@storytree/library";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

/** A node's health as the tree shows it: the agent's report, labelled as the agent's, then what storytree verified. */
function healthOf(health: NodeHealth): string {
  const words = (state: string): string => state.replace("-", " ");
  return `agent says ${words(health.reported.state)} · storytree verified ${words(health.verified.state)}`;
}

/** Who holds `id`, if anyone. */
function claimOn(claims: readonly Claim[], id: string): string {
  const claim = claims.find((held) => held.capability === id || held.increment === id);
  return claim === undefined ? "" : `  ⟵ ${claim.label} (${claim.holder}): ${claim.reason}`;
}

const tree: Verb = {
  name: "tree",
  usage: "tree [<story>]",
  summary: "stories, capabilities and contracts, with the agent's reported health and any claim",
  async act(args, context) {
    const named = args.words[0];
    const plan = await (await context.library()).projectTree();
    const stories = named === undefined ? plan.stories : plan.stories.filter((story) => story.id === named || story.title.toLowerCase() === named.toLowerCase());
    if (named !== undefined && stories.length === 0) {
      throw new Refusal(`no story "${named}" in this project`, { next: [{ command: "storytree tree", why: "every story" }] });
    }
    if (stories.length === 0) return { text: "No stories yet.", next: [{ command: "storytree library new story --title <title>", why: "add one" }] };
    const claims = await context.claims();
    const lines: string[] = [];
    for (const story of stories) {
      lines.push(`${story.title}  [${story.id}]  ${healthOf(story.health)}`);
      story.capabilities.forEach((capability, index) => {
        lines.push(`  ${index + 1} · ${capability.title}  [${capability.id}]  ${healthOf(capability.health)}${claimOn(claims, capability.id)}`);
        for (const contract of capability.contracts) {
          lines.push(`      - ${contract.title}  [${contract.id}]  ${healthOf(contract.health)}`);
        }
      });
    }
    return { text: lines.join("\n") };
  },
};

export const plan: Family = {
  name: "tree",
  summary: "the plan as a tree, with each part's reported health",
  verbs: [],
  bare: tree,
};
