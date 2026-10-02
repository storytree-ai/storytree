# Browser-build service shutdown

`increment_ea88ad89bea4`, Mint box, 2026-10-02. The browser-build test now calls
esbuild's `stop()` in a root `after` hook, before Node starts process teardown.
The existing browser bundle assertion and all test, exit-watch and unit limits
remain unchanged.

The reported intermittent exit hang did **not** reproduce in the baseline:
100 complete forest-unit runs, four concurrent at a time, all passed and exited.
Each unit ran 164 tests. The comparison uses the same load after explicit service
shutdown; [measurements.json](measurements.json) records both source commits,
runtime, deadlines, result counts and durations. This verifies the cleanup change
under load; it does not establish that the rare historical deadlock is eliminated.
No artificial failing test was introduced for an unreproduced failure.

The experiment uses the existing unit runner, including its 20-second exit watch,
and stops at the first failure. From either source checkout:

```sh
node --input-type=module <<'JS'
import { globSync } from 'node:fs';
import { runUnit, unitLimit } from './packages/dev-loop/src/unit-run.mjs';
const root = process.cwd();
const files = globSync('packages/forest/src/**/*.test.{ts,mjs}').sort();
const unitLimitMs = unitLimit('packages/forest').ms;
for (let batch = 0; batch < 25; batch++) {
  const results = await Promise.all(Array.from({ length: 4 }, () => runUnit({
    root, files, env: { ...process.env, STORYTREE_EMBEDDER: 'off' },
    unitLimitMs, stdio: ['ignore', 'ignore', 'inherit'],
  })));
  console.log(JSON.stringify({ batch, results }));
  if (results.some(result => result.code !== 0)) { process.exitCode = 1; break; }
}
JS
```

During the recorded runs, each unit's output was retained in its own `/tmp` log,
along with its full `runUnit` result, to distinguish assertion failures, deadline
kills and exit-watch kills. Those temporary logs are not new test infrastructure.
