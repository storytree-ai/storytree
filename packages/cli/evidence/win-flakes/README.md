# Windows flake diagnostics — increment_655d99c13fc3

Red commit: `d0375c3` (`red(win-flakes): require child output and file failure causes`).
`red.txt` is the actual failing run, after that commit was pushed:

```sh
flock /tmp/storytree-heavy.lock node --import tsx --test packages/cli/src/testing/cli.test.ts scripts/unit-run.test.mjs
```

Both added tests failed; the four existing runner tests passed. The CLI helper failure lacked
stderr/stdout. The runner failure lacked a file diagnostic containing exit code and stderr.

The green change leaves setup and land-relief product behavior unchanged. Every built-command
exit assertion in setup.test.ts now uses the diagnostic helper. Its command capture waits for
`close`, so output pipes have drained. The existing supplementary test reporter prints file
failures with exit code, signal and up to the last 16,384 characters of each file's stderr (explicitly marked
when truncated, or empty). The regression runs exit, load-error, unhandled-rejection and healthy
fixtures concurrently, plus a signal fixture on Unix.

The bare-file failure is reproducible without Windows: `process.exit(7)` before any test makes
Node v24.19.0's spec reporter print only `test failed`. In Node's own loaded source,
`internal/test_runner/runner` attaches exitCode/signal to ERR_TEST_FAILURE, while
`internal/test_runner/reporter/utils` formats only its `cause`. We preserve the missing fields.
Both reporters formerly targeted stdout; an experiment showed spec completing that shared
stream discarded the supplementary reporter's final output. It now targets stderr and emits on
the root summary, before `--test-force-exit` can end the process. Relative stderr file paths are
normalized to match absolute failure paths.

This explains the missing diagnostics, not the cause of the original Windows ARM64 land-relief
failure. No speculative product fix or contract/library change was made.

## CI measurement

Snapshot through CI run 36383081834 on 2026-09-28. Began with
`gh run list --repo storytree-ai/storytree --workflow CI --limit 100`, then paginated all 268
workflow runs. Enumerated jobs with `jobs?filter=all&per_page=100`, counting exact job name
`verify on Windows` from PR #6's first run 36220438084 (2026-09-26T05:19:06Z).
Eight experimental Windows jobs on earlier PR #5 are excluded.

Each failed job was read with:
`gh run view RUN --repo storytree-ai/storytree --attempt 1 --job JOB --log-failed`.
Explicit attempt matters: without it, run 36304914968 returned the later cancelled attempt's
log despite the old job ID. Counts below are actual job attempts, never prose mentions.

| Windows job outcome | Attempts |
| --- | ---: |
| Success | 179 |
| Failure | 14 |
| Cancelled | 61 |
| Total (248 workflow runs) | 254 |

| Failure category | Windows job attempts |
| --- | ---: |
| Target: CLI setup disconnect both | 1 |
| Target: forest-world land-relief | 0 |
| Other tests outside their PR's changed packages | 2 |
| Tests related to their PR change | 8 |
| Related installed-app packaging | 2 |
| Related typecheck | 1 |
| Infrastructure | 0 |

All 14 failures were attempt 1:

| Run / Windows job | PR | Cause in job log | Classification |
| --- | ---: | --- | --- |
| [36381110274 / 108796877365](https://github.com/storytree-ai/storytree/actions/runs/36381110274/job/108796877365) | 167 | setup.test.ts: disconnect both, actual 1 expected 2 | Target |
| [36378863815 / 108790233922](https://github.com/storytree-ai/storytree/actions/runs/36378863815/job/108790233922) | 164 | PowerShell bootstrap: reject damaged installer before running it, actual 1 expected 0 | Related test |
| [36365439047 / 108750804537](https://github.com/storytree-ai/storytree/actions/runs/36365439047/job/108750804537) | 159 | Installed delivery: ENOENT node_modules/koffi/build/koffi/index.js | Related packaging |
| [36364460907 / 108747997143](https://github.com/storytree-ai/storytree/actions/runs/36364460907/job/108747997143) | 159 | Installed delivery: Unsafe payload path node_modules/@koromix/koffi-win32-x64/index.js | Related packaging |
| [36358718028 / 108731485464](https://github.com/storytree-ai/storytree/actions/runs/36358718028/job/108731485464) | 152 | own/foundation.test.ts:125 unreadable-record gaps assertion | Related test |
| [36304914968 / 108579523308](https://github.com/storytree-ai/storytree/actions/runs/36304914968/job/108579523308) | 111 | Library cloud history cleanup: permission denied to terminate process, 42501 | Unrelated other test |
| [36302547501 / 108572827244](https://github.com/storytree-ai/storytree/actions/runs/36302547501/job/108572827244) | 103 | Library cloud edit cleanup: permission denied to terminate process, 42501 | Unrelated other test |
| [36288373911 / 108533456354](https://github.com/storytree-ai/storytree/actions/runs/36288373911/job/108533456354) | 84 | Windows setup-remove: actual 1 expected 0 | Related test |
| [36288150995 / 108532801590](https://github.com/storytree-ai/storytree/actions/runs/36288150995/job/108532801590) | 84 | Windows setup-remove: actual 1 expected 0 | Related test |
| [36287901972 / 108532071656](https://github.com/storytree-ai/storytree/actions/runs/36287901972/job/108532071656) | 84 | Wrapper preserves failure status: actual 0 expected 2 | Related test |
| [36287632315 / 108531298530](https://github.com/storytree-ai/storytree/actions/runs/36287632315/job/108531298530) | 84 | Windows setup-remove: actual 1 expected 0 | Related test |
| [36286908801 / 108529277153](https://github.com/storytree-ai/storytree/actions/runs/36286908801/job/108529277153) | 83 | CLI launcher: installed storytree.cmd setup remove failed | Related test |
| [36275635702 / 108497709339](https://github.com/storytree-ai/storytree/actions/runs/36275635702/job/108497709339) | 51 | agent-link/tools/text.ts: TS2366 missing return, lines 10/22/34 | Related typecheck |
| [36223070315 / 108351840948](https://github.com/storytree-ai/storytree/actions/runs/36223070315/job/108351840948) | 11 | Activity-log: read ECONNRESET during applySchema | Related test |

The pnpm test step itself succeeded 198 times, failed 11, was cancelled 27, skipped 14 and absent
four times. Job outcomes differ because cancellation and installer checks can follow tests.
Six second attempts exist: 36355381251, 36354713054, 36319724871, 36304914968, 36304794004 and
36297718079; five Windows jobs passed, and 36304914968 was cancelled.

Classification compares each failure's stack location with its PR file list. #103 changes
arc-surface/story files; #111 relocates forest views and changes desktop/build/package wiring.
Both unrelated failures point to library/src/testing/pg.ts:105 via cloud-connection.test.ts:762.
This is an inference about reach, not proof of cause. #167 changes agent-link code imported by
CLI, so its unchanged early usage check does not rule out a command import/load failure.

These are scoped CI attempts, including cancellations, not ten controlled full Windows runs.
No CI log establishes the cause of the local ARM64 land-relief failure. Recommend landing the
diagnostics, without claiming either original flake has been eliminated.

## Green verification

`flock /tmp/storytree-heavy.lock pnpm gate` passed typecheck and all 14 full-suite units.
`green.txt` retains the tables. Guidance was NOT RUN because no roles, notes or generated files
changed. The external Cloud SQL proof remains explicitly skipped without Google identity.
A read-only review found a potential capture race in the regression itself; its capture helper
now waits for the child's close before reading streams, retaining the runner's bounded exit.

`pnpm test-ratio` all row (test lines / implementation lines / ratio):

```text
  all                       42,060           33,826    1.24
```
