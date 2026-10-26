/**
 * Capability 3 · Counts before detail. The `map` and `affected` verbs, declared here (ADR-0969 D2) and named under `verbs`
 * in the package's manifest (ADR-1033), so the command line mounts them as its `map` and `affected` families and drops
 * them with the map when this computer switches it off (ADR-1095). The map owns selection and answers; the command line
 * only reads the words. No tool: the focus tool serves the map to agents. Only the library's command schema's types are
 * read here, and its refusal and the caller's imports inside the acts, which only a door that has them runs: a user's CI
 * installs this package without the library or Project and caller.
 */
import type { Verb, VerbContext, VerbFamily, VerbInputs } from "@storytree/library/verbs";
import type { FocusOptions } from "./focus.js";
import type { NodeKind } from "./graph.js";

const SELECTION = {
  up: { kind: "text", describe: "how many hops of dependencies to follow", optional: true },
  down: { kind: "text", describe: "how many hops of dependents to follow", optional: true },
  kind: { kind: "text", describe: "the node kinds to return, comma-separated: story, capability, promise, file, test", optional: true },
  "dry-run": { kind: "switch", describe: "the row count and estimated token cost, without rows" },
  show: { kind: "switch", describe: "every selected row, or a refusal with the counts above the ceiling" },
  json: { kind: "switch", describe: "answer as JSON" },
} as const;

type Selection = { readonly up: string | undefined; readonly down: string | undefined; readonly kind: string | undefined; readonly "dry-run": boolean; readonly show: boolean };

/** How far and how the map answers, from the words given: `--show` and `--dry-run` together are refused. */
async function selection(input: Selection): Promise<Omit<FocusOptions, "select">> {
  const { VerbRefusal } = await import("@storytree/library/verbs");
  if (input.show && input["dry-run"]) throw new VerbRefusal("Use either --show or --dry-run.", { misuse: true });
  return {
    ...(input.up === undefined ? {} : { up: Number(input.up) }),
    ...(input.down === undefined ? {} : { down: Number(input.down) }),
    ...(input.kind === undefined ? {} : { kind: input.kind.split(",").map((value) => value.trim()) as NodeKind[] }),
    mode: input.show ? "show" : input["dry-run"] ? "dry_run" : "counts",
  };
}

/** The patterns a line is drawn round, comma-separated. */
async function crossingPatterns(text: string): Promise<string[]> {
  const { VerbRefusal } = await import("@storytree/library/verbs");
  const patterns = text.split(",").map((value) => value.trim()).filter((value) => value !== "");
  if (patterns.length === 0) throw new VerbRefusal("Name the folders, file patterns or explored capabilities: --crossing <pattern|cap:<id|number>,...>.", { misuse: true });
  return patterns;
}

/** A crossing's line is narrowed only to a mapped story: --select story:<name>. */
async function crossingStory(select: string | undefined): Promise<{ story?: string }> {
  if (select === undefined) return {};
  const { VerbRefusal } = await import("@storytree/library/verbs");
  if (!select.startsWith("story:") || select.length === 6) throw new VerbRefusal("With --crossing, --select names a mapped story: story:<name>.", { misuse: true });
  return { story: select.slice(6) };
}

const mapInputs = {
  select: { kind: "text", describe: "file:<path>, cap:<id|number>, promise:<id|number>, story:<name> or diff:<range>; with --crossing, story:<mapped>", optional: true },
  crossing: { kind: "text", describe: "the folders, file patterns or explored capabilities a line is drawn round, comma-separated", optional: true },
  ...SELECTION,
} as const;

const map: Verb<typeof mapInputs> = {
  command: {
    family: "map",
    name: "map",
    summary: "up follows dependencies; down follows dependents; --crossing counts the imports across a line in a mapped island; show refuses above 200 rows; JSON on every mode",
    usage: "map --select file:<path>|cap:<id|number>|promise:<id|number>|story:<name>|diff:<range> [--up N] [--down N] [--kind story,capability,promise,file,test] [--dry-run|--show] [--json], or map --crossing <folder|pattern|cap:<id|number>,...> [--select story:<mapped>] [--show] [--json]",
  },
  tool: { absent: "the focus tool serves the map to agents" },
  inputs: mapInputs,
  async act(input, context) {
    if (input.crossing === undefined && input.select === undefined) {
      const { VerbRefusal } = await import("@storytree/library/verbs");
      throw new VerbRefusal("this needs --select", { misuse: true });
    }
    const options = await selection(input);
    const crossing = input.crossing === undefined ? undefined : { patterns: await crossingPatterns(input.crossing), ...await crossingStory(input.select), mode: input.show ? "show" as const : "counts" as const };
    const [{ crossingCommand, mapCommand }, { importsOf, machineOf, storytreeHome }] = await Promise.all([import("./read.js"), import("@storytree/project-and-caller")]);
    if (context.server === undefined) throw new Error("the map reads this machine's imports from the library server, which this door did not open");
    // The folders this machine imports, where the map reads the mapped stories (ADR-0993 D2).
    const imports = await importsOf(context.server, context.library.name, machineOf(storytreeHome()).id);
    if (crossing !== undefined) return { text: await crossingCommand(context.library, context.folder, crossing, input.json, imports) };
    return { text: await mapCommand(context.library, context.folder, { select: input.select!, ...options }, input.json, imports) };
  },
};

const affectedInputs = {
  given: { kind: "text", describe: "the git range, A..B or a commit", word: 0, optional: true },
  range: { kind: "text", describe: "the git range, A..B or a commit", optional: true },
  ...SELECTION,
} as const;

const affected: Verb<typeof affectedInputs> = {
  command: {
    family: "affected",
    name: "affected",
    summary: "defaults to origin/main's merge-base against the working tree, including untracked files; A..B compares commits; down limits impact hops, up follows dependencies",
    usage: "affected [<range>|--range <range>] [--up N] [--down N] [--kind story,capability,promise,file,test] [--dry-run|--show] [--json]",
  },
  tool: { absent: "the focus tool's diff:<range> selection serves a branch's impact to agents" },
  inputs: affectedInputs,
  async act(input, context) {
    if (input.given !== undefined && input.range !== undefined) {
      const { VerbRefusal } = await import("@storytree/library/verbs");
      throw new VerbRefusal("Give one range, as a word or --range.", { misuse: true });
    }
    const options = await selection(input);
    const range = input.given ?? input.range;
    const { affectedCommand } = await import("./read.js");
    return { text: await affectedCommand(context.library, context.folder, { ...options, ...(range === undefined ? {} : { range }) }, input.json) };
  },
};

/** The command line's `map` and `affected` families, 16th and 17th among `storytree`'s families. */
export const MAP_FAMILIES: readonly VerbFamily[] = [
  { name: "map", summary: "focus dependencies and dependents of a file, capability, promise or story; counts first", order: 16, verbs: [], bare: map as Verb<VerbInputs, VerbContext> },
  { name: "affected", summary: "map a branch's changed files to the promises, dependents and tests they affect; counts first", order: 17, verbs: [], bare: affected as Verb<VerbInputs, VerbContext> },
];
