// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./index.mjs";

const rule = plugin.rules["no-unguarded-batch-fetch"];
const code = (...lines) => lines.join("\n").replaceAll("#", "$").replaceAll("'", "`");
const refused = (line, ...lines) => ({ code: code(...lines), errors: [{ messageId: "unguarded", line }] });

test("8.24 · storytree/no-unguarded-batch-fetch refuses an await of a job-log or artifacts fetch inside Promise.all(list.map(async ...)) that no try around it or .catch on it handles, called directly (read-ci's and harvest's pre-fix shapes, an artifacts list) or through a same-file function or const arrow whose own body awaits one unguarded (watch.mjs's jobLog), and a try in the callback that does not enclose the await; its message names escape_9d756d18be61; a try/catch around it, a .catch on it, a for loop, a helper that catches and a runs/<id>/jobs fetch pass", () => {
  assert.match(rule?.meta?.messages?.unguarded ?? "", /escape_9d756d18be61/);

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("no-unguarded-batch-fetch", rule, {
    valid: [
      code(
        "export const read = (github: GitHub, repository: string, jobs: { id: number }[]) => Promise.all(jobs.map(async (job) => {",
        "  try {",
        "    const log = await github.text('repos/#{repository}/actions/jobs/#{job.id}/logs');",
        "    return { log };",
        "  } catch (error) {",
        "    if (/HTTP 404/.test(String(error))) return { log: \"\" };",
        "    throw error;",
        "  }",
        "}));",
      ),
      code(
        "export const read = (github: GitHub, api: string, jobs: { id: number }[]) => Promise.all(jobs.map(async (job) => ({",
        "  log: await github.text('#{api}/actions/jobs/#{job.id}/logs').catch(() => \"\"),",
        "})));",
      ),
      code(
        "export async function read(github: GitHub, api: string, jobs: { id: number }[]) {",
        "  const logs: string[] = [];",
        "  for (const job of jobs) logs.push(await github.text('#{api}/actions/jobs/#{job.id}/logs'));",
        "  return logs;",
        "}",
      ),
      code(
        "async function jobLog(github: GitHub, api: string, id: number) {",
        "  try {",
        "    return await github.text('#{api}/actions/jobs/#{id}/logs');",
        "  } catch {",
        "    return \"\";",
        "  }",
        "}",
        "export const read = (github: GitHub, api: string, jobs: { id: number }[]) => Promise.all(jobs.map(async (job) => ({ log: await jobLog(github, api, job.id) })));",
      ),
      code(
        "export const read = (github: GitHub, api: string, runs: { id: number }[]) => Promise.all(runs.map(async (one) => {",
        "  const { jobs } = await github.json('#{api}/actions/runs/#{one.id}/jobs');",
        "  return jobs;",
        "}));",
      ),
    ],
    invalid: [
      refused(3,
        "export async function jobResults(github: GitHub, repository: string, jobs: { id: number }[]) {",
        "  return Promise.all(jobs.map(async (job) => {",
        "    const log = await github.text('repos/#{repository}/actions/jobs/#{job.id}/logs');",
        "    return { log };",
        "  }));",
        "}",
      ),
      refused(3,
        "export const facts = async (github: GitHub, api: string, listedJobs: { id: number; name: string; conclusion: string | null }[]) => Promise.all(listedJobs.map(async (job) => ({",
        "  name: job.name,",
        "  log: job.conclusion === \"failure\" || job.conclusion === \"timed_out\" ? await github.text('#{api}/actions/jobs/#{job.id}/logs') : \"\",",
        "})));",
      ),
      refused(6,
        "const jobLogs = new Map();",
        "async function jobLog(repo: string, id: number, api: string) {",
        "  if (!jobLogs.has(id)) jobLogs.set(id, (await run(\"gh\", [\"api\", '#{api}/actions/jobs/#{id}/logs'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })).stdout);",
        "  return jobLogs.get(id);",
        "}",
        "export const read = (repo: string, jobs: { id: number }[], api: string) => Promise.all(jobs.map(async (job) => ({ ...job, log: redJob(job) ? await jobLog(repo, job.id, api) : \"\" })));",
      ),
      refused(5,
        "const logOf = async (github: GitHub, api: string, id: number) => {",
        "  const text = await github.text('#{api}/actions/jobs/#{id}/logs');",
        "  return text;",
        "};",
        "export const read = (github: GitHub, api: string, jobs: { id: number }[]) => Promise.all(jobs.map(async (job) => ({ log: await logOf(github, api, job.id) })));",
      ),
      refused(2,
        "export const artifacts = (github: GitHub, api: string, runs: { id: number }[]) => Promise.all(runs.map(async (one) => ({",
        "  artifacts: await github.json('#{api}/actions/runs/#{one.id}/artifacts'),",
        "})));",
      ),
      refused(7,
        "export const read = (github: GitHub, api: string, jobs: { id: number }[]) => Promise.all(jobs.map(async (job) => {",
        "  try {",
        "    check(job);",
        "  } catch {",
        "    return { log: \"\" };",
        "  }",
        "  const log = await github.text('#{api}/actions/jobs/#{job.id}/logs');",
        "  return { log };",
        "}));",
      ),
    ],
  });
});
