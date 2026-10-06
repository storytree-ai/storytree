// Capability 5 · Library tools. `pnpm record:acceptance <observations.json> [--dry-run]`: write an acceptance run's verdicts to the
// verified column of 0.3's own library (ADR-0825 D5). The observations file is the harness's: the
// story it accepts, the commit, the evidence path and each check it observed
// (packages/dev-loop/src/acceptance-health.mjs says the rules). The library is the one the storytree
// setting names, as `pnpm check:own-health` run by hand opens it; `--dry-run` prints the verdicts and
// writes nothing.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { readLibrary } from "@storytree/agent-link";
import { connect } from "@storytree/library";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { mintAcceptance, readObservations, recordAcceptance, ACCEPTED_BY } from "./acceptance-health.mjs";
import { appLibraryServer } from "./library-server.mjs";
import { contractsOf, recordingTarget } from "./own-health.mjs";

const PROJECT = "storytree";
const COMMAND = "pnpm record:acceptance";

let server; // the app's Postgres, while it runs

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\nrecord: interrupted; stopping Postgres");
    void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\nrecord: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main(args) {
  const dryRun = args.includes("--dry-run");
  const file = args.find((arg) => !arg.startsWith("--"));
  if (file === undefined) {
    console.error(`usage: ${COMMAND} <observations.json> [--dry-run]`);
    return 2;
  }
  const run = readObservations(readFileSync(file, "utf8"));

  const home = appHome();
  // An acceptance run is recorded by hand, from the machine that drove it: never as CI's identity.
  const target = recordingTarget({ env: {}, setting: readLibrary(home.dir) });
  let where;
  if (target.library === "app") {
    server = await appLibraryServer(COMMAND, { writes: !dryRun });
    where = { url: server.url };
  } else where = target.library;

  let storytree;
  try {
    storytree = await connect(where);
    const library = await storytree.openProject(PROJECT);
    try {
      return await acceptRun(library, run, { dryRun });
    } finally {
      await library.close();
    }
  } finally {
    await storytree?.close();
    await server?.stop();
  }
}

/**
 * Write `run`'s verdicts to the verified column of its story's contracts in `library`, or with
 * `dryRun` only print them. 1 when the library has no story by the run's name, else 0.
 */
export async function acceptRun(library, run, { dryRun, log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const story = (await library.projectTree()).stories.find(({ title }) => title === run.story);
  if (story === undefined) {
    error(`\nThe library's project has no story "${run.story}".`);
    return 1;
  }
  const { numbers, contractIds } = contractsOf(story);
  const verdicts = mintAcceptance({ contracts: numbers, checks: run.checks });
  const unknown = [...new Set(run.checks.map(({ contract }) => contract).filter((number) => !contractIds.has(number)))];
  if (unknown.length > 0) log(`checks for contracts "${run.story}" does not have count for none: ${unknown.join(", ")}`);

  log(`\nacceptance of "${run.story}" at commit ${run.commit}, evidence ${run.evidence}, by "${ACCEPTED_BY}":`);
  for (const verdict of verdicts.values()) {
    if (verdict.total === 0) continue;
    log(`  ${verdict.number.padEnd(5)} ${verdict.state.padEnd(12)} ${verdict.note ?? verdict.reason}`);
  }
  if (dryRun) {
    log("\n--dry-run: nothing written.");
    return 0;
  }
  const written = await recordAcceptance(library, contractIds, verdicts, run);
  log(`\nrecorded: ${written.passing} passing, ${written.failing} failing; nothing written for the ${written.notChecked} not checked.`);
  return 0;
}
