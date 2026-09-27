# Setup help — capabilities 3, 4 and 5

Story `story_b91056a06337`; increment `increment_02c57ba72540`; arc `arc_cfc7db517fae`.

The new `@storytree/app-setup` package owns the first-run guide, folder diagnostic/recovery
actions, offline license reader and reviewed GitHub feedback drafts. The desktop mounts it
outside project content and supplies OS actions. Exported `deliver` and `connect` homes are ready
for capabilities 1 and 2; they contain no implementation. The public browser subpath is `/view`.

## Evidence

- [red.txt](red.txt): after pushed red commit `e11bac8`, the new behavior tests fail because
  feedback and shipped-license implementations do not yet exist.
- [green.txt](green.txt): typecheck, focused behavior tests and full-scope repository test result.
- [capture/result.json](capture/result.json): actual desktop renderer in headless Chromium,
  isolated Postgres, public setup diagnostics and app project reads. Browser/clipboard actions
  are fake; nothing is submitted to GitHub. The script stops the browser/database and removes its
  temporary home even on failure.
- [capture.mjs](capture.mjs): executable acceptance using the existing capture pattern. It checks
  the first-run offer, dismissal/reopen, folder-check cancellation and recovery, offline license
  access/retry, reviewed feedback/cancellation/retry/copy, both forests after normal refresh,
  library failure, dark theme and an unobstructed arc handle at 1120×860 and 640×480.
- The Windows installer check in `apps/desktop/check-install.mjs` now compares the license bytes
  in the installed NSIS product and arm64 unpacked payload with the repository resource. That
  Windows check has not run on this Linux host.

```sh
flock /tmp/storytree-heavy.lock pnpm typecheck
flock /tmp/storytree-heavy.lock pnpm test
STORYTREE_PLAYWRIGHT=/path/to/playwright-core/index.mjs \
  flock /tmp/storytree-heavy.lock node --import tsx packages/app-setup/evidence/help/capture.mjs
pnpm test-ratio
```

The recorded run used Playwright 1.60.0 and cached Chromium 1223. `STORYTREE_CHROMIUM` can select
another installed Chromium. `STORYTREE_HELP_OUT` can redirect screenshots/results outside the
checkout. Browser acceptance is additional to the regular node tests, not a new test framework.

## Pictures for review

- [First launch without a project](capture/first-run.png)
- [Public setup diagnostics](capture/diagnostics.png)
- [License while offline](capture/offline-license.png)
- [Feedback draft opened](capture/feedback-draft.png)
- [First forest](capture/first-project.png) and [second forest](capture/second-project.png)
- [Minimum window](capture/small-window.png) and [library failure, dark theme](capture/library-error-dark.png)

Geometry and actions were checked by the capture. These pictures are supplied for the owner's
visual review; this lane does not attest the owner's acceptance of the appearance.

## Handoffs and limits

[Library patch and checklist](library-update/README.md) append as-built/evidence descriptions
without creating records or changing contract titles. No live library, claims, decisions or
questions were read or written. No decision-log or agent-role curation was needed.

Contract 3.3's complete journey still needs two explicit user yes answers in real empty-folder
agent sessions on Windows, including both harnesses' approval prompts and actual hook receipt.
Here `setUpProject` supplies two approved-setup fixtures to exercise help and normal app refresh;
that is not the real consent walkthrough. Capabilities 1 and 2 must join installation and agent
connection to this guide. Installed arm64 access and license access after a real release update
also remain with that Windows lane; replacing the resource during browser acceptance is only a
local check that the license reader does not retain stale bytes.

The desktop folder check deliberately supplies no hook command: it reports the agent link's
existing skipped-hook/command diagnostics, and the guide directs those cases to the adjacent
copyable request for the installed agent. It neither creates a project nor implements hook setup.

### File-fence blocker

The brief excludes `pnpm-lock.yaml`, while CI requires `pnpm install --frozen-lockfile`.
Registering the package and desktop dependency makes that install fail with
[`ERR_PNPM_OUTDATED_LOCKFILE`](frozen-install.txt). Permission to include the generated lockfile change was requested;
until granted, the root lockfile remains untouched and this branch is not ready for a non-draft PR.

[workspace-lock.patch](workspace-lock.patch) is the exact pnpm-generated change, produced in a
temporary directory containing only copies of workspace manifests and the existing lockfile.
It adds the package importer and desktop workspace link, without changing dependency versions.
Local checks used `pnpm install --lockfile=false` to install workspace links without crossing the
fence. The patch is ready for review/application if the fence is expanded. This is an integration
blocker, not a passing frozen-install result.
