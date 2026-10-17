// Capability 4 · Recording a test run. A story's run: its own packages' tests, and each dependant's test titled with its
// package (a title like processes 3.6: …, ADR-0845), run through the caller's test runner, judged by test-run.mjs's
// rules and written to each contract's verified column, saying in the log what it saw and recorded. Since every story
// numbers its contracts from 1.1, another package's test counts for the story only when its title names the story's
// package first. A story with no package has no tests yet, so its contracts are left not checked.
//
// Only the verified column is written. The reported column is what an agent says through the agent link, and this
// never writes it: showing the two apart is the point of the two columns.

import { existsSync } from "node:fs";
import path from "node:path";

import { contractsCoveredBy, contractsOf, creditPlatforms, dependantTestsNaming, judge, packageOf, recordHealth, sourcesOf, unseenPlatform } from "./test-run.mjs";

/**
 * Run `story`'s own tests (those of its packages under `root`, through `runTests`, which gives the run's exit code and
 * its junit report's results) and record each of its contracts' verified health from what they showed. False if the run produced no report, so no
 * health could be recorded.
 */
export async function checkStory(library, story, writer, { root, evidence = [], runTests, log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const { numbers, contractIds } = contractsOf(story);
  const name = packageOf(story.title);
  const sources = sourcesOf(name).map((dir) => path.join(root, dir));
  if (!existsSync(sources[0])) {
    log(`\n"${story.title}" has no tests yet (no packages/${name}), so its ${numbers.length} contracts are left not checked.`);
    return true;
  }
  const owned = sourcesOf(name).filter((dir) => existsSync(path.join(root, dir)));
  const tests = [...owned.flatMap((dir) => [`${dir}/**/*.test.ts`, `${dir}/**/*.test.mjs`]), ...dependantTestsNaming(name, { root })];
  log(`\nrunning the tests of "${story.title}" (${tests.join(", ")}, junit reporter) …`);
  const run = await runTests(tests, root);
  if (run.results === undefined) {
    error(`\nThe test run (exit code ${run.code}) produced no report, so no health was recorded for "${story.title}".`);
    return false;
  }
  const sourceOf = (test) => sources.find((source) => !path.relative(source, path.resolve(root, test)).startsWith(".."));
  const dependant = (test) => sourceOf(test) === undefined;
  const count = (status) => run.results.filter((result) => result.status === status).length;
  log(`tests: ${run.results.length} results: ${count("passed")} passed, ${count("failed")} failed, ${count("skipped")} skipped`);
  // The junit report goes to a file, so the log is the only place a failure seen only here can be traced from (friction_065efa9f6ad4).
  const failed = run.results.filter((result) => result.status === "failed");
  if (failed.length > 0) log(`\n${failed.length} failing test(s):`);
  for (const result of failed) {
    log(`  ${[...result.suites, result.name].join(" > ")}  (${path.relative(root, path.resolve(root, result.file)).replaceAll("\\", "/")})`);
    for (const line of (result.message ?? "(no message)").split("\n")) log(`    ${line}`);
  }

  const { verdicts, unmapped, stray, crashedFiles } = judge({
    contracts: numbers,
    results: creditPlatforms(run.results, evidence, { root, commit: writer.commit }),
    coverage: (test) => (dependant(test) ? contractsCoveredBy(test, { root: path.join(root, "packages"), prefix: name }) : contractsCoveredBy(test, { root: sourceOf(test) })),
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
  if (stray.length > 0) {
    // A capability moved to another story leaves dependants' titles with the old package first: they pass but prove nothing (friction_2f5f177c7e09).
    log(`\n${stray.length} test(s) titled with "${name}" name a number "${story.title}" does not have, so that number counts for none; retitle each with its story's package:`);
    for (const { result, numbers } of stray) log(`  ${numbers.join(", ").padEnd(7)} ${path.relative(root, result.file).replaceAll("\\", "/")}: ${result.name}`);
  }
  if (unmapped.length > 0) {
    log(`\n${unmapped.length} test(s) name no contract of the story, so they count for none:`);
    for (const result of unmapped) log(`  ${result.status.padEnd(7)} ${result.name}`);
  }

  // Without a CI system's evidence, a run cannot re-run a test that only runs there: that system's pass stands.
  const platformsSeen = new Set(evidence.filter(Boolean).map(({ platform }) => platform));
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
        if (verdict.unrun === true && earlier.state === "passing") line += `; its earlier pass (${earlier.at}) stands: the ${verdict.skip} CI run did not reach its tests`;
        else if (unseenPlatform(verdict.skip, platformsSeen) && earlier.state === "passing") line += `; its earlier pass (${earlier.at}) stands: no ${verdict.skip} CI run to re-run it`;
        else if (earlier.state !== "not-checked") line += `; its earlier entry (${earlier.state}, ${earlier.at}) is marked not re-run`;
        if (verdict.skip !== undefined) line += ` [skip: ${verdict.skip}]`;
      }
      log(line);
    }
  }
  const written = await recordHealth(library, contractIds, verdicts, writer, { platformsSeen });
  log(
    `\nrecorded: ${written.passing} passing, ${written.failing} failing; ` +
      `${written.notChecked} not checked, ${written.marked} of them marked with a skip's kind or as not re-run. The reported column is untouched.`,
  );
  return true;
}
