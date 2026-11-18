// Capability 7 · Own health

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { factoryFolder, readLibrary } from "@storytree/project-and-caller";
import { connect } from "@storytree/library";
import { factoryArgument, recordFactory } from "./test-run/factory-run.mjs";
import { jobProofsFrom } from "./test-run/job-proofs.mjs";
import { checkStory } from "./test-run/record-run.mjs";
import { markPending, parseJunit, readCiEvidence, recordingTarget } from "./test-run/test-run.mjs";

import { appHome } from "../../../apps/desktop/src/home.ts";
import { appLibraryServer } from "./library-server.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";
const COMMAND = "pnpm check:own-health";

let server;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once("SIGINT", () => {
    console.error("\ncheck: interrupted; stopping Postgres");
    void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
  main({ factory: factoryArgument(process.argv.slice(2), () => factoryFolder().folder) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`\ncheck: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    },
  );
}

async function main({ factory } = {}) {
  const home = appHome();
  const target = recordingTarget({ env: process.env, setting: readLibrary(home.dir) });
  if (!target.record) {
    console.log(target.why);
    return 0;
  }
  target.writer.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const { commit } = target.writer;
  const evidence = [
    readCiEvidence(process.env.STORYTREE_WINDOWS_EVIDENCE, { commit, run: process.env.STORYTREE_WINDOWS_RUN, platform: "win32" }),
    readCiEvidence(process.env.STORYTREE_MACOS_EVIDENCE, { commit, run: process.env.STORYTREE_MACOS_RUN, platform: "darwin" }),
  ];
  const jobProofs = jobProofsFrom(process.env.STORYTREE_JOB_PROOFS);
  for (const { package: name, contract, state } of jobProofs) console.log(`workflow job proof: ${name} ${contract} ${state}`);
  let where;
  if (target.library === "app") {
    console.log(`the app's library: ${home.pgdata}`);
    server = await appLibraryServer(COMMAND, { writes: true });
    where = { url: server.url };
  } else {
    console.log(`the library at ${target.library.address}`);
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
      if (factory !== undefined) return await recordFactory(library, stories, factory.folder, { unrecorded: factory.unrecorded, env: withoutLibrarySignIn(process.env) });
      let pending = 0;
      for (const story of stories) pending += (await markPending(library, story, target.writer, { root })).length;
      console.log(`marked ${pending} contracts pending: this run's numbered tests name them and their verified health is not yet passing`);
      for (const story of stories) {
        if (!(await checkStory(library, story, target.writer, { root, evidence, jobProofs, runTests: runStoryTests }))) code = 1;
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

export async function runStoryTests(globs, root) {
  const work = mkdtempSync(path.join(tmpdir(), "storytree-health-"));
  const report = path.join(work, "tests.xml");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", path.join(root, "packages", "repo-checks", "src", "test.mjs"), "--test-reporter=junit", `--test-reporter-destination=${report}`, ...globs],
        { cwd: root, stdio: "inherit", env: withoutLibrarySignIn(process.env) },
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

function withoutLibrarySignIn(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(GOOGLE_|CLOUDSDK_|GCLOUD_|GCP_|PG|HEALTH_PG_)/.test(name)));
}
