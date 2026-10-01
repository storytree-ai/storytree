// Helper for grade-todomvc.ps1: runs the official TodoMVC Cypress spec once
// through Cypress's module API and writes per-test results as JSON.
//
//   node run-cypress.mjs <projectDir> <specFile> <framework> <browser> <outJson> [baseUrl]
//
// Nothing about the spec or its config is changed: the framework goes in as
// the env var the spec reads (Cypress.env('framework')), and video and
// failure screenshots are switched off so a run leaves no artefacts behind.
// baseUrl is overridden only when the caller serves on a port other than the
// config's 8000.
import cypress from 'cypress';
import { writeFileSync } from 'node:fs';

const [, , project, spec, framework, browser, out, baseUrl] = process.argv;
if (!out) {
  console.error('usage: node run-cypress.mjs <projectDir> <specFile> <framework> <browser> <outJson> [baseUrl]');
  process.exit(64);
}

const config = { video: false, screenshotOnRunFailure: false };
if (baseUrl) config.baseUrl = baseUrl;

const res = await cypress.run({ project, spec, browser, env: { framework }, config });

if (res.status === 'failed') {
  // Cypress itself could not run (binary, config or browser problem).
  writeFileSync(out, JSON.stringify({ runError: res.message || 'cypress failed to run' }, null, 2));
  console.error(res.message);
  process.exit(2);
}

const tests = res.runs.flatMap((run) =>
  run.tests.map((t) => ({
    title: t.title,
    state: t.state,
    error: t.displayError ? t.displayError.split('\n')[0] : null,
  })),
);

writeFileSync(
  out,
  JSON.stringify(
    {
      cypressVersion: res.cypressVersion,
      browser: `${res.browserName} ${res.browserVersion}`,
      totals: {
        tests: res.totalTests,
        passed: res.totalPassed,
        failed: res.totalFailed,
        pending: res.totalPending,
        skipped: res.totalSkipped,
      },
      tests,
    },
    null,
    2,
  ),
);
process.exit(res.totalFailed > 0 ? 1 : 0);
