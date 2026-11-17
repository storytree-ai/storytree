/**
 * Capability 1 · Harvesting failed CI runs. The `harvest` verbs, declared here (ADR-0969 D2) and named under `verbs` in
 * the package's manifest (ADR-1033), so the command line mounts them as its `harvest` family: `harvest ci` sorts every
 * failed CI run of the last days once (infra counted, each flaky test to its one investigation, each real failure and
 * escape recorded as an escape pattern) and prints what it sorted, for the agent running it to judge the patterns
 * (ADR-1356 D2). The Mint box runs it daily as a scheduled process; it is no tool.
 */
import { verb, VerbRefusal, type VerbFamily } from "@storytree/library/verbs";

const ci = verb({
  command: { family: "harvest", name: "ci", summary: "sort every failed CI run of the last days once: infra counted, each flaky test to its one investigation, each real failure and escape to an escape pattern for you to judge" },
  tool: { absent: "a step for the Mint box's daily scheduled process, whose agent then judges the escape patterns it recorded" },
  inputs: { days: { kind: "count", optional: true, describe: "how many days back to list failed runs; 7 when not given" } },
  writes: true,
  async act({ days = 7 }, { library, project, folder, server, writer }) {
    const [{ gitHubSource, harvest, harvestText, watcherReading }, { harvestLedger, harvestPool }, { ghApi, gitIn, repositoryOf }, { ciScopeRule }] = await Promise.all([
      import("./harvest.js"), import("./store.js"), import("@storytree/ci-health"), import("@storytree/ci-health/scope"),
    ]);
    const repository = repositoryOf(await gitIn(folder)(["remote", "get-url", "origin"]).catch(() => ""));
    if (repository === undefined) return { text: "This project has no GitHub origin, so storytree has no failed CI runs to harvest; nothing was sorted." };
    if (server === undefined) throw new VerbRefusal("The harvested runs are kept beside the library, and this door has no library server open.");
    const watcher = await watcherReading();
    const counts = await harvest({
      library, watcher, days, ...(writer === undefined ? {} : { write: writer }),
      source: gitHubSource(ghApi(), repository, watcher, ciScopeRule(folder)),
      ledger: harvestLedger(await harvestPool(server), project),
    });
    return { text: harvestText(counts), next: [{ command: "library list escape", why: "judge each unjudged escape pattern: its class, construct, other places, and whether it generalises" }] };
  },
});

/** The command line's `harvest` family. */
export const HARVEST_FAMILIES: readonly VerbFamily[] = [
  { name: "harvest", summary: "harvesting failed CI runs: flakes to their investigations, real failures and escapes to escape patterns", order: 18.5, verbs: [ci] },
];
