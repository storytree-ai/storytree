// Capability 7 · Own health

import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { applyJobProofs } from "./job-proofs.mjs";
import { contractsCoveredBy, contractsOf, creditPlatforms, dependantTestsNaming, judge, packageOf, recordHealth, sourcesOf } from "./test-run.mjs";

export async function checkStory(library, story, writer, { root, folders, evidence = [], jobProofs = [], runTests, platform = process.platform, pause = sleep, log = (line) => console.log(line), error = (line) => console.error(line) }) {
  const { numbers, contractIds } = contractsOf(story);
  const name = packageOf(story);
  const dirs = folders ?? sourcesOf(name);
  const sources = dirs.map((dir) => path.join(root, dir));
  if (!existsSync(sources[0])) {
    log(`\n"${story.title}" has no tests yet (no ${folders === undefined ? `packages/${name}` : folders[0]}), so its ${numbers.length} contracts are left not checked.`);
    return true;
  }
  const owned = dirs.filter((dir) => existsSync(path.join(root, dir)));
  const tests = [...owned.flatMap((dir) => [`${dir}/**/*.test.ts`, `${dir}/**/*.test.mjs`]), ...(folders === undefined ? dependantTestsNaming(name, { root }) : [])];
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
  applyJobProofs(verdicts, name, jobProofs);
  const flakes = [...new Set([...verdicts.values()].flatMap((verdict) => verdict.flaky ?? []))];
  if (flakes.length > 0) {
    log(`\n${flakes.length} failing test(s) the passing CI run of this commit passed, recorded failing and named flaky, so the box's telling investigates each:`);
    for (const flake of flakes) log(`  ${flake}`);
  }
  const platformsSeen = new Set([platform, ...evidence.filter(Boolean).map(({ platform: seen }) => seen)]);
  const unreached = (verdict) => verdict.state === "not-checked" && /^platform:/.test(verdict.skip ?? "") && !platformsSeen.has(verdict.skip.slice("platform:".length));
  for (const verdict of verdicts.values()) if (unreached(verdict)) verdict.unrun = true;
  for (const { file: crashed, contracts: held } of crashedFiles) {
    log(
      `\n${path.relative(root, crashed)} produced no results: its process died before running any test (a known flake).\n` +
        `  Its contracts are left not checked, not failed: ${held.join(", ") || "(none found)"}. Run the check again to check them.`,
    );
  }
  if (stray.length > 0) {
    log(`\n${stray.length} test(s) titled with "${name}" name a number "${story.title}" does not have, so that number counts for none; retitle each with its story's package:`);
    for (const { result, numbers } of stray) log(`  ${numbers.join(", ").padEnd(7)} ${path.relative(root, result.file).replaceAll("\\", "/")}: ${result.name}`);
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
        const earlier = (await retrying(() => library.health(contract.id), { pause, log })).verified;
        if (unreached(verdict) && earlier.state === "passing") line += `; its earlier pass (${earlier.at}) stands: this ${platform} run cannot re-run a ${verdict.skip} test`;
        else if (verdict.unrun === true && earlier.state === "passing") line += `; its earlier pass (${earlier.at}) stands: the ${verdict.skip} CI run did not reach its tests`;
        else if (earlier.state !== "not-checked") line += `; its earlier entry (${earlier.state}, ${earlier.at}) is marked not re-run`;
        if (verdict.skip !== undefined) line += ` [skip: ${verdict.skip}]`;
      }
      log(line);
    }
  }
  const written = await retrying(() => recordHealth(library, contractIds, verdicts, writer, { platformsSeen }), { pause, log });
  log(
    `\nrecorded: ${written.passing} passing, ${written.failing} failing; ` +
      `${written.notChecked} not checked, ${written.marked} of them marked with a skip's kind or as not re-run. The reported column is untouched.`,
  );
  if (written.retired !== undefined) log(`skipped ${written.retired.length} contract(s) retired on the library since this run read the plan, so nothing was recorded on them: ${written.retired.join(", ")}`);
  if (written.untold !== undefined) log(`recorded ${written.untold.length} verdict(s) whose follow-up write (the owner's FYI on a turn red or green again, a release of waiting work) this writer's library role may not make, so it was not made: ${written.untold.join(", ")}`);
  return true;
}

const RETRY_PAUSES = [5_000, 15_000, 30_000];

async function retrying(call, { pause, log }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= RETRY_PAUSES.length || !connectionLost(error)) throw error;
      log(`the library's connection was lost (${error.message}); trying again in ${RETRY_PAUSES[attempt] / 1000} s with a fresh one`);
      await pause(RETRY_PAUSES[attempt]);
    }
  }
}

function connectionLost(error) {
  const { code, message } = error ?? {};
  return (
    code === "25P03" ||
    ["ECONNRESET", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "ECONNREFUSED"].includes(code) ||
    /Connection terminated|timeout exceeded when trying to connect|timeout expired/i.test(message ?? "")
  );
}
