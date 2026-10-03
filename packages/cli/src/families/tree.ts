/**
 * Capability 10 · Plan view (the command line story): `storytree tree` prints the plan as an indented
 * tree: stories, capabilities and contracts, each with the health its agent reported (labelled as
 * the agent's) and any claim on it, and each capability's word with why it is not healthy (ADR-0825 D1). Name a story to see only that story.
 *
 * One reading of the library's projectTree, whose health is already rolled up by the library, and
 * one of the agent link's claims. A story is named by its id or its title.
 *
 * `storytree health ci` reads the project's CI test results into its verified health (the CI health story, ADR-0902).
 * `storytree health worklist` prints the oldest three capabilities on the library's health
 * worklist (ADR-0825 D4), for the librarian pass to route.
 */
import type { Claim } from "@storytree/agent-link";
import { NOT_VERIFIED, wordAndWhy, type NodeHealth } from "@storytree/library";
import { ghApi, gitIn, readProjectCi } from "@storytree/ci-health";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

/**
 * A node's health as the tree shows it: the agent's report, labelled as the agent's, then what
 * storytree verified; the report alone in a project nothing verifies (ADR-0630).
 */
function healthOf(health: NodeHealth, unverified: boolean): string {
  const words = (state: string): string => state.replace("-", " ");
  const reported = `agent says ${words(health.reported.state)}`;
  return unverified ? reported : `${reported} · storytree verified ${words(health.verified.state)}`;
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
    const unverified = plan.unverified === true;
    for (const story of stories) {
      lines.push(`${story.title}  [${story.id}]  ${healthOf(story.health, unverified)}`);
      story.capabilities.forEach((capability, index) => {
        lines.push(`  ${index + 1} · ${capability.title}  [${capability.id}]  ${healthOf(capability.health, unverified)}; ${capability.reportOnly ? NOT_VERIFIED : wordAndWhy(capability)}${claimOn(claims, capability.id)}`);
        for (const contract of capability.contracts) {
          lines.push(`      - ${contract.title}  [${contract.id}]  ${healthOf(contract.health, unverified)}`);
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

const worklist: Verb = {
  name: "worklist",
  usage: "health worklist",
  summary: "the oldest three capabilities that are not healthy, with why, who moves each and since when",
  async act(_args, context) {
    const listed = await (await context.library()).healthWorklist();
    if (listed.length === 0) return { text: "Nothing waits on the health worklist: every capability is healthy or already routed." };
    const shown = listed.slice(0, 3);
    const lines = shown.map(({ capability, title, status, why, since }) =>
      `${title}  [${capability}]  ${status} — ${why.reason}, the ${why.mover}'s to move${why.contracts.length === 0 ? "" : `: ${why.contracts.join(", ")}`}; since ${since.slice(0, 10)}`,
    );
    if (listed.length > shown.length) lines.push(`${listed.length - shown.length} more wait.`);
    return { text: lines.join("\n"), next: [{ command: "storytree arc increment new --arc <arc> --title <t> --objective <o> --body <text> --touches <capability> [--held-on <question>]", why: "route one: an increment that touches it, held on a question when it needs the owner" }] };
  },
};

const ci: Verb = {
  name: "ci",
  usage: "health ci",
  summary: "read this project's CI test results (its newest push run on GitHub) into its verified health",
  async act(_args, context) {
    const read = await readProjectCi({ library: await context.library(), git: gitIn(context.cwd), github: ghApi() });
    if (!read.written) return { text: read.why };
    return {
      text: `Read ${read.tests} test results from ${read.run} (commit ${read.commit.slice(0, 12)}): ${read.passing} contracts verified passing, ${read.failing} failing, ${read.notChecked} not checked by a skip` +
        `${read.unmatched === 0 ? "." : `; ${read.unmatched} results named no contract of one story.`}`,
      next: [{ command: "storytree tree", why: "see each contract's verified health beside the agent's report" }],
    };
  },
};

export const health: Family = {
  name: "health",
  summary: "the health worklist, and reading a project's CI into its verified health",
  verbs: [worklist, ci],
};
