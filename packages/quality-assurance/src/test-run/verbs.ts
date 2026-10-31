/**
 * Capability 8 · Verified test run. The `run-tests` verb, declared here (ADR-1033 D3) and named under `verbs` in the
 * package's manifest, so the command line mounts it as its `run-tests` family: run_tests's twin (ADR-0793), for a user's
 * agent without the MCP server. It runs and records the same verified run with the same answer, so a run either door
 * recorded is read by the other. It is callerless: a run needs the folder's Git checkout, not a project or library. It is
 * no tool: this package's tool part serves run_tests on the MCP server.
 */
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";

const runTests = verb({
  consumers: ["agent"],
  command: { family: "run-tests", name: "run-tests", summary: "run the project's test command in this folder and record the run against its files; at the same files and command it answers with that verified run instead", usage: "run-tests \"<command>\" [--fresh]" },
  tool: { absent: "this package's tool part serves the same run as run_tests on the MCP server" },
  inputs: {
    command: { kind: "text", word: 0, describe: "the project's test command, exactly as each role gives it, in one quoted word" },
    fresh: { kind: "switch", describe: "run it even if a run is recorded at these files" },
  },
  callerless: true,
  async act({ command, fresh }, { folder, session }: VerbPlace) {
    const { runText, verifiedRun } = await import("./test-run.js");
    let answer;
    try {
      answer = await verifiedRun(folder, command, session ?? "the command line", fresh);
    } catch (error) {
      throw new VerbRefusal((error as Error).message);
    }
    return { text: runText(answer), data: { ...answer } };
  },
});

/** The command line's `run-tests` family, just after `quality` among `storytree`'s families. */
export const TEST_RUN_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "run-tests", summary: "run the project's test command and record it against the folder's files, or read the run already recorded there (run_tests's twin)", order: 10.5, verbs: [], bare: runTests },
];
