// Capability 5 · Library tools. `pnpm check:own-health`: run each of 0.3's own stories' tests and record each contract's VERIFIED
// health in the project `storytree`. The library is the one copy of those stories (ADR-0641), so
// each story, its contracts and their numbers are read from it; nothing is read from a file into
// it. This is what stayed of `pnpm seed:library` when its file-to-library half was deleted
// (ADR-0641 D2 step 4, choice H1).
//
// Which library, and as whom (packages/dev-loop/src/own-health.mjs's recordingTarget):
// - On CI (.github/workflows/own-health.yml, after each merge to main, ADR-0744 D3), the Cloud SQL
//   library, signed in as CI's own service account (infra/ci-health), as "storytree test run on
//   CI", with the commit in each note. With that identity not configured, it says so and records
//   nothing, successfully.
// - Run by hand, the library the storytree setting names (`storytree settings show`): the Cloud SQL
//   instance, signed in as the setting's account; or the desktop app's own (~/.storytree/0.3/pgdata),
//   joining the running app's database, or starting the app's Postgres itself when the app is not
//   running, and holding the one-writer lock while it records (packages/dev-loop/src/library-server.mjs), so the
//   app never restarts into an update mid-write.
//
// A story's tests are its own package's: the story is proven by the tests in packages/<name>/src,
// the package named after its title (packages/dev-loop/src/own-health.mjs's packageOf). Since every story
// numbers its contracts from 1.1, another package's test counts for the story only when its title
// names the story's package first (a title like processes 3.6: …): a dependant proving the story's contract
// through its own front door (ADR-0845). A story with no such package has no tests yet, so its contracts are
// left not checked.
//
// Only the verified column is written. The reported column is what an agent says through the agent
// link, and this never writes it: showing the two apart is the point of the two columns. The rules
// for what counts as passing live in packages/dev-loop/src/own-health.mjs.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readLibrary } from "@storytree/agent-link";
import { connect } from "@storytree/library";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";
import { contractsCoveredBy, contractsOf, creditWindows, dependantTestsNaming, judge, packageOf, parseJunit, readWindowsEvidence, recordHealth, recordingTarget } from "./own-health.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";
const COMMAND = "pnpm check:own-health";

let server; // the app's Postgres, while it runs

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\ncheck: interrupted; stopping Postgres");
    void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\ncheck: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main() {
  const home = appHome();
  const target = recordingTarget({ env: process.env, setting: readLibrary(home.dir) });
  if (!target.record) {
    console.log(target.why);
    return 0;
  }
  // workflow_run's GITHUB_SHA names the default branch, not necessarily the checked-out CI commit.
  target.writer.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const windows = readWindowsEvidence(process.env.STORYTREE_WINDOWS_EVIDENCE, { commit: target.writer.commit, run: process.env.STORYTREE_WINDOWS_RUN });
  let where;
  if (target.library === "app") {
    console.log(`the app's library: ${home.pgdata}`);
    server = await appLibraryServer(COMMAND, { writes: true });
    where = { url: server.url };
  } else {
    console.log(`the library on Cloud SQL: ${target.library.cloudSql.instance}, as ${target.library.cloudSql.user}`);
    where = target.library;
  }

  let storytree;
  try {
    storytree = await connect(where);
    if (!(await storytree.listProjects()).includes(PROJECT)) {
      console.error(`\nThe library has no project "${PROJECT}", so there are no stories to check.`);
      return 1;
    }
    const library = await storytree.openProject(PROJECT);
    try {
      let code = 0;
      for (const story of (await library.projectTree()).stories) {
        if (!(await checkStory(library, story, target.writer, { root, windows }))) code = 1;
      }
      return code;
    } finally {
      await library.close();
    }
  } finally {
    await storytree?.close();
    await server?.stop();
  }
}

/**
 * Run `story`'s own tests (those of its package under `root`, through `runTests`) and record each of
 * its contracts' verified health from what they showed. False if the run produced no report, so no
 * health could be recorded.
 */
export async function checkStory(library, story, writer, { root, windows, runTests = runStoryTests, log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const { numbers, contractIds } = contractsOf(story);
  const name = packageOf(story.title);
  const source = path.join(root, "packages", name, "src");
  if (!existsSync(source)) {
    log(`\n"${story.title}" has no tests yet (no packages/${name}), so its ${numbers.length} contracts are left not checked.`);
    return true;
  }
  const tests = [`packages/${name}/src/**/*.test.ts`, `packages/${name}/src/**/*.test.mjs`, ...dependantTestsNaming(name, { root })];
  log(`\nrunning the tests of "${story.title}" (${tests.join(", ")}, junit reporter) …`);
  const run = await runTests(tests, root);
  if (run.results === undefined) {
    error(`\nThe test run (exit code ${run.code}) produced no report, so no health was recorded for "${story.title}".`);
    return false;
  }
  const dependant = (test) => path.relative(source, path.resolve(root, test)).startsWith("..");
  const count = (status) => run.results.filter((result) => result.status === status).length;
  log(`tests: ${run.results.length} results: ${count("passed")} passed, ${count("failed")} failed, ${count("skipped")} skipped`);

  const { verdicts, unmapped, crashedFiles } = judge({
    contracts: numbers,
    results: creditWindows(run.results, windows, { root, commit: writer.commit }),
    coverage: (test) => (dependant(test) ? contractsCoveredBy(test, { root: path.join(root, "packages"), prefix: name }) : contractsCoveredBy(test, { root: source })),
    show: (test) => path.relative(root, test),
    prefix: name,
    dependant,
  });
  for (const { file: crashed, contracts: held } of crashedFiles) {
    log(
      `\n${path.relative(root, crashed)} produced no results: its process died before running any test (a known flake).\n` +
        `  Its contracts are left not checked, not failed: ${held.join(", ") || "(none found)"}. Run the check again to check them.`,
    );
  }
  if (unmapped.length > 0) {
    log(`\n${unmapped.length} test(s) name no contract of the story, so they count for none:`);
    for (const result of unmapped) log(`  ${result.status.padEnd(7)} ${result.name}`);
  }

  log(`\nverified health of "${story.title}", by "${writer.by}"${writer.commit === undefined ? "" : ` at commit ${writer.commit}`}:`);
  for (const capability of story.capabilities) {
    log(`  ${capability.title}`);
    for (const contract of capability.contracts) {
      const number = /^(\d+\.\d+) · /.exec(contract.title)?.[1];
      const verdict = number === undefined ? undefined : verdicts.get(number);
      if (verdict === undefined) continue;
      let line = `    ${number.padEnd(5)} ${verdict.state.padEnd(12)} ${verdict.note ?? verdict.reason ?? ""}`;
      if (verdict.state === "not-checked") {
        const earlier = (await library.health(contract.id)).verified;
        if (earlier.state !== "not-checked") line += `; its earlier entry (${earlier.state}, ${earlier.at}) is marked not re-run`;
        if (verdict.skip !== undefined) line += ` [skip: ${verdict.skip}]`;
      }
      log(line);
    }
  }
  const written = await recordHealth(library, contractIds, verdicts, writer);
  log(
    `\nrecorded: ${written.passing} passing, ${written.failing} failing; ` +
      `${written.notChecked} not checked, ${written.marked} of them marked with a skip's kind or as not re-run. The reported column is untouched.`,
  );
  return true;
}

/** Run the tests `globs` name through the test harness (its own throwaway Postgres), reading their junit report. */
async function runStoryTests(globs, root) {
  const work = mkdtempSync(path.join(tmpdir(), "storytree-health-"));
  const report = path.join(work, "tests.xml");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", path.join(root, "packages", "dev-loop", "src", "test.mjs"), "--test-reporter=junit", `--test-reporter-destination=${report}`, ...globs],
        { cwd: root, stdio: "inherit", env: withoutGoogleSignIn(process.env) },
      );
      child.on("error", reject);
      child.on("exit", (exitCode) => resolve(exitCode ?? 1));
    });
    const xml = existsSync(report) ? readFileSync(report, "utf8") : "";
    return { code, results: xml.includes("<testsuites") ? parseJunit(xml) : undefined };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The environment without CI's Google sign-in (what google-github-actions/auth exports): the
 * stories' tests run against their own throwaway Postgres, and none of them may reach the real
 * library as CI's identity.
 */
function withoutGoogleSignIn(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(GOOGLE_|CLOUDSDK_|GCLOUD_|GCP_)/.test(name)));
}
