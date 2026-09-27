// `pnpm seed:library`: put this repo's own stories and decisions into the project `storytree` in
// the desktop app's library (~/.storytree/0.3/pgdata). Every story file (stories/*.md) becomes a
// story with its capabilities and contracts, each capability's founding book (its shelf's first
// item in the story file) a front cover of that capability, and every decision file (decisions/*.md)
// a front cover of the story or capability it decided, or, for a decision about the whole project,
// a decision on no shelf. Then each story's tests are run, and each contract's VERIFIED health is recorded from
// what they showed.
//
// The app's Postgres is started here, on the app's own data directory, and stopped again at the
// end. While the app is running it holds that directory, so the seed says so and exits non-zero:
// quit the app first. A second run updates everything in place and never duplicates it.
//
// A story's tests are its own package's: stories/<name>.md is proven by the tests in
// packages/<name>/src, and nobody else's, since every story numbers its contracts from 1.1. A
// story with no such package has no tests yet, so its contracts are left not checked.
//
// Only the verified column is written. The reported column is what an agent says through the agent
// link, and the seed never writes it: showing the two apart is the point of the two columns.
// The rules for what counts as passing, and for filing decisions, live in scripts/library-seed.mjs.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import { DataDirInUseError, start } from "@storytree/local-postgres";

import { APP_OWNER, appHome } from "../apps/desktop/src/home.ts";
import {
  contractsCoveredBy,
  judge,
  parseDecision,
  parseJunit,
  parseStory,
  recordHealth,
  syncDecisions,
  syncFoundingBooks,
  syncStories,
  VERIFIED_BY,
} from "./library-seed.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "storytree";
const STORIES = "stories";
const DECISIONS = "decisions";
const SEED = "pnpm seed:library";

let server; // the app's Postgres, while it runs
process.once("SIGINT", () => {
  console.error("\nseed: interrupted; stopping Postgres");
  void (server?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
});

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\nseed: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  },
);

async function main() {
  const home = appHome();
  // Read every file first, so a broken one fails before anything starts.
  const stories = markdownIn(STORIES).map((file) => ({ file, story: parse(file, parseStory) }));
  const decisions = markdownIn(DECISIONS)
    .map((file) => parse(file, parseDecision))
    .sort((a, b) => a.record.localeCompare(b.record)); // oldest record first, so a node's founding book is its oldest
  for (const { file, story } of stories) {
    const contracts = story.capabilities.reduce((count, capability) => count + capability.contracts.length, 0);
    console.log(`${file}: "${story.title}", ${story.capabilities.length} capabilities, ${contracts} contracts`);
  }
  console.log(`${DECISIONS}/: ${decisions.length} decision${decisions.length === 1 ? "" : "s"}`);
  console.log(`the app's library: ${home.pgdata}`);

  try {
    server = await start({ dataDir: home.pgdata, owner: SEED, log: (message) => console.log(`Postgres: ${message}`) });
  } catch (error) {
    if (!(error instanceof DataDirInUseError)) throw error;
    console.error(
      error.owner === APP_OWNER
        ? `\nThe storytree 0.3 app is running (pid ${error.pid}) and holds its library in ${home.pgdata}.\n` +
            `Quit the app, then run \`${SEED}\` again.`
        : `\nThe app's library in ${home.pgdata} is in use by process ${error.pid}` +
            `${error.owner === undefined ? "" : ` (${error.owner})`}. When it has finished, run \`${SEED}\` again.`,
    );
    return 1;
  }

  let storytree;
  try {
    storytree = await connect({ url: server.url });
    const existed = (await storytree.listProjects()).includes(PROJECT);
    const library = await storytree.openProject(PROJECT);
    console.log(`project "${PROJECT}": ${existed ? "opened" : "created"}`);

    const { synced, crossStoryLinks, dependenciesUpdated } = await syncStories(library, stories);
    /** @type {Map<string, string>} node id -> how to name it */
    const names = new Map();
    for (const { file, story } of stories) {
      const result = synced.get(file);
      const { capabilities: caps, contracts: ks } = result.counts;
      console.log(`\nstory "${story.title}" (${file}): ${result.counts.story}`);
      console.log(`  capabilities: ${caps.added} added, ${caps.updated} updated, ${caps.unchanged} unchanged, ${caps.retired} retired`);
      console.log(`  contracts: ${ks.added} added, ${ks.reworded} reworded, ${ks.unchanged} unchanged, ${ks.retired} retired`);
      names.set(result.storyId, `the story "${story.title}"`);
      for (const capability of story.capabilities) {
        names.set(result.capabilityIds.get(String(capability.number)), `"${story.title}" › ${capability.title}`);
      }
    }
    console.log(`\ndependencies: ${crossStoryLinks} cross-story links; ${dependenciesUpdated} capabilities' links updated`);
    const titles = new Set(stories.map(({ story }) => story.title));
    for (const other of (await library.projectTree()).stories.filter(({ title }) => !titles.has(title))) {
      console.log(`note: the library also has the story "${other.title}", which no story file names; it is left as it is`);
    }

    // Founding books before decision files, so on a new library each is its shelf's first.
    const books = (await syncFoundingBooks(library, stories, synced, decisions)).counts;
    console.log(
      `\nfounding books: ${books.added} added, ${books.updated} updated, ${books.unchanged} unchanged, ` +
        `${books.offShelf} taken off their shelves`,
    );

    const filed = await syncDecisions(library, decisions, synced);
    const { added, updated, unchanged, offShelf } = filed.counts;
    console.log(`\ndecisions: ${added} added, ${updated} updated, ${unchanged} unchanged, ${offShelf} taken off their shelves`);
    for (const { record, title } of decisions) {
      const nodeId = filed.placed.get(record);
      console.log(`  ${record} "${title}": ${nodeId === undefined ? "on no shelf" : `a front cover of ${names.get(nodeId)}`}`);
    }

    let code = 0;
    for (const { file, story } of stories) {
      if (!(await checkStory(library, file, story, synced.get(file)))) code = 1;
    }
    await library.close();
    return code;
  } finally {
    await storytree?.close();
    await server.stop();
  }
}

/** The .md files in the repo's `dir`, as repo paths (`stories/library.md`), sorted; none if it does not exist. */
function markdownIn(dir) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/** `read` applied to the file's text, a failure naming the file. */
function parse(file, read) {
  try {
    return read(readFileSync(path.join(root, file), "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

/**
 * Run `story`'s own tests and record each of its contracts' verified health from what they showed.
 * False if the run produced no report, so no health could be recorded.
 */
async function checkStory(library, file, story, { contractIds }) {
  const contracts = story.capabilities.flatMap((capability) => capability.contracts.map((contract) => contract.number));
  const name = path.basename(file, ".md");
  const source = path.join(root, "packages", name, "src");
  if (!existsSync(source)) {
    console.log(`\n"${story.title}" has no tests yet (no packages/${name}), so its ${contracts.length} contracts are left not checked.`);
    return true;
  }
  const tests = `packages/${name}/src/**/*.test.ts`;
  console.log(`\nrunning the tests of "${story.title}" (${tests}, junit reporter) …`);
  const run = await runTests(tests);
  if (run.results === undefined) {
    console.error(`\nThe test run (exit code ${run.code}) produced no report, so no health was recorded for "${story.title}".`);
    return false;
  }
  const passedCount = run.results.filter(({ status }) => status === "passed").length;
  const failedCount = run.results.filter(({ status }) => status === "failed").length;
  const skippedCount = run.results.filter(({ status }) => status === "skipped").length;
  console.log(`tests: ${run.results.length} results: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`);

  const { verdicts, unmapped, crashedFiles } = judge({
    contracts,
    results: run.results,
    coverage: (test) => contractsCoveredBy(test, { root: source }),
    show: (test) => path.relative(root, test),
  });
  for (const { file: crashed, contracts: held } of crashedFiles) {
    console.log(
      `\n${path.relative(root, crashed)} produced no results: its process died before running any test (a known flake).\n` +
        `  Its contracts are left not checked, not failed: ${held.join(", ") || "(none found)"}. Run the seed again to check them.`,
    );
  }
  if (unmapped.length > 0) {
    console.log(`\n${unmapped.length} test(s) name no contract of the story, so they count for none:`);
    for (const result of unmapped) console.log(`  ${result.status.padEnd(7)} ${result.name}`);
  }

  console.log(`\nverified health of "${story.title}", by "${VERIFIED_BY}":`);
  for (const capability of story.capabilities) {
    console.log(`  ${capability.title}`);
    for (const { number } of capability.contracts) {
      const verdict = verdicts.get(number);
      let line = `    ${number.padEnd(5)} ${verdict.state.padEnd(12)} ${verdict.note ?? verdict.reason ?? ""}`;
      if (verdict.state === "not-checked") {
        const earlier = (await library.health(contractIds.get(number))).verified;
        if (earlier.state !== "not-checked") line += `; its earlier entry (${earlier.state}, ${earlier.at}) is left as it was`;
      }
      console.log(line);
    }
  }
  const written = await recordHealth(library, contractIds, verdicts);
  console.log(
    `\nrecorded: ${written.passing} passing, ${written.failing} failing; ` +
      `${written.notChecked} not checked (nothing written for those). The reported column is untouched.`,
  );
  return true;
}

/** Run the tests `glob` names through the test harness (its own throwaway Postgres), reading their junit report. */
async function runTests(glob) {
  const work = mkdtempSync(path.join(tmpdir(), "storytree-seed-"));
  const report = path.join(work, "tests.xml");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import", "tsx",
          path.join(root, "scripts", "test.mjs"),
          "--test-reporter=junit",
          `--test-reporter-destination=${report}`,
          glob,
        ],
        { cwd: root, stdio: "inherit" },
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
