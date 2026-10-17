// Capability 5 · Library tools. `pnpm check:own-health`: storytree's own health, which is CI health's recording of a test
// run (packages/ci-health/src/test-run, ADR-1066 D2 G) configured for storytree: each of 0.3's own stories' tests run
// through this repo's test harness, and each contract's VERIFIED health recorded in the project `storytree`. The library
// is the one copy of those stories (ADR-0641), so each story, its contracts and their numbers are read from it. What
// counts as passing, and how each verdict is written, are CI health's.
//
// Which library, and as whom (CI health's recordingTarget):
// - On CI (.github/workflows/own-health.yml, after each merge to main, ADR-0744 D3), as "storytree
//   test run on CI", with the commit in each note: the library at HEALTH_PG_ADDRESS over Tailscale
//   (ADR-0928 D4). With that variable unset, it says so and records nothing, successfully.
// - Run by hand, the library the storytree setting names (`storytree settings show`): a Cloud SQL
//   instance, signed in as the setting's account; a Postgres address; or the desktop app's own (~/.storytree/0.3/pgdata),
//   joining the running app's database, or starting the app's Postgres itself when the app is not
//   running, and holding the one-writer lock while it records (packages/dev-loop/src/library-server.mjs), so the
//   app never restarts into an update mid-write.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readLibrary } from "@storytree/project-and-caller";
import { connect } from "@storytree/library";
import { checkStory } from "@storytree/ci-health/record-run";
import { markPending, parseJunit, readCiEvidence, recordingTarget } from "@storytree/ci-health/test-run";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";

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
  const { commit } = target.writer;
  const evidence = [
    readCiEvidence(process.env.STORYTREE_WINDOWS_EVIDENCE, { commit, run: process.env.STORYTREE_WINDOWS_RUN, platform: "win32" }),
    readCiEvidence(process.env.STORYTREE_MACOS_EVIDENCE, { commit, run: process.env.STORYTREE_MACOS_RUN, platform: "darwin" }),
  ];
  let where;
  if (target.library === "app") {
    console.log(`the app's library: ${home.pgdata}`);
    server = await appLibraryServer(COMMAND, { writes: true });
    where = { url: server.url };
  } else if ("address" in target.library) {
    console.log(`the library at ${target.library.address}`);
    where = target.library;
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
      const { stories } = await library.projectTree();
      // Say first what this run will record, so the health worklist holds it back meanwhile (CI health's markPending).
      let pending = 0;
      for (const story of stories) pending += (await markPending(library, story, target.writer, { root })).length;
      console.log(`marked ${pending} contracts pending: this run's numbered tests name them and their verified health is not yet passing`);
      for (const story of stories) {
        if (!(await checkStory(library, story, target.writer, { root, evidence, runTests: runStoryTests }))) code = 1;
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

/** Run the tests `globs` name through this repo's test harness (its own throwaway Postgres), reading their junit report. */
export async function runStoryTests(globs, root) {
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
