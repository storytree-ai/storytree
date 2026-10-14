/**
 * Capability 3 · Reading the project's CI. The `health` verbs, declared here (ADR-0969 D2) and named under `verbs` in the
 * package's manifest (ADR-1033), so the command line mounts them as its `health` family: `health ci` reads the project's
 * CI test results into its verified health (ADR-0902), and `health worklist` prints the oldest three capabilities on the
 * map's health worklist (ADR-0825 D4), for the librarian pass to route, and how many a test run in progress holds back.
 * Neither is a tool: the MCP server's own `health_worklist` gives the worklist, and reading CI is a terminal step.
 */
import { verb, type VerbFamily } from "@storytree/project-and-caller/verbs";

const worklist = verb({
  command: { family: "health", name: "worklist", summary: "the oldest three capabilities that are not healthy, with why, who moves each and since when" },
  tool: { absent: "the MCP server's own health_worklist tool gives the worklist" },
  inputs: {},
  async act(_input, { library, folder }) {
    const { heldBack } = await import("@storytree/library");
    const { healthWorklistAt } = await import("@storytree/map/read");
    const all = await healthWorklistAt(library, folder);
    const held = heldBack(all);
    const listed = all.filter(({ waits }) => waits === undefined);
    if (listed.length === 0) return { text: ["Nothing waits on the health worklist: every capability is healthy or already routed.", ...(held === undefined ? [] : [held])].join("\n") };
    const shown = listed.slice(0, 3);
    const lines = shown.map(({ capability, title, status, why, since, contractsPass }) =>
      `${title}  [${capability}]  ${status} — ${why.reason}, the ${why.mover}'s to move${why.contracts.length === 0 ? "" : `: ${why.contracts.join(", ")}`}; since ${since.slice(0, 10)}` +
      (contractsPass ? "; its tests already pass on main; only its proposed flag is left" : ""),
    );
    if (listed.length > shown.length) lines.push(`${listed.length - shown.length} more wait.`);
    if (held !== undefined) lines.push(held);
    const built = shown.filter(({ contractsPass }) => contractsPass).map(({ capability }) => ({ command: `capability built ${capability}`, why: "its tests already pass: switch its proposed flag off (ADR-0744 D2)" }));
    const unbuilt = shown.some(({ contractsPass }) => !contractsPass);
    return { text: lines.join("\n"), next: [...built, ...(unbuilt ? [{ command: "arc increment new --arc <arc> --title <t> --objective <o> --body <text> --capabilities <capability> [--held-on <question>]", why: "route one: an increment whose capabilities list names it, held on a question when it needs the owner" }] : [])] };
  },
});

const ci = verb({
  command: { family: "health", name: "ci", summary: "read this project's CI test results (its newest push run on GitHub) into its verified health" },
  tool: { absent: "reading a project's CI is a step for its terminal" },
  inputs: {},
  async act(_input, { library, folder }) {
    const { ghApi, gitIn, readProjectCi } = await import("./read-ci/read-ci.js");
    const read = await readProjectCi({ library, git: gitIn(folder), github: ghApi() });
    if (!read.written) return { text: read.why };
    return {
      text: `Read ${read.tests} test results from ${read.run} (commit ${read.commit.slice(0, 12)}): ${read.passing} contracts verified passing, ${read.failing} failing, ${read.notChecked} not checked by a skip` +
        `${read.unmatched === 0 ? "." : `; ${read.unmatched} results named no contract of one story.`}`,
      next: [{ command: "tree", why: "see each contract's verified health beside the agent's report" }],
    };
  },
});

/** The command line's `health` family, 18th among `storytree`'s families. */
export const HEALTH_FAMILIES: readonly VerbFamily[] = [
  { name: "health", summary: "the health worklist, and reading a project's CI into its verified health", order: 18, verbs: [worklist, ci] },
];
