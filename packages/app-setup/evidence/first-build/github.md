# Conduit adopts GitHub and grows a backend

**The existing Conduit app is now in a private GitHub repository.** Build
PR #1 establishes the official frontend pipeline; PR #2 fixes the feed race
it exposes. Both merge after their hosted checks pass. The independent grades
and the limitations they reveal are recorded below; the backend trial follows.

This continues the [folder-only Conduit build](conduit.md) in Codex's existing
`conduit-codex` project on the old Windows laptop. Codex builds from user prompts;
the supervisor on Mint observes, reads the library, captures the app, and grades
copies of the build. The supervisor never edits the build. The laptop runs
Codex CLI 0.158.0 with `gpt-6-astra`; the supervising Mint lane also uses
`gpt-6-astra`.

## Starting point

- The frontend previously passed the official RealWorld suite, **139/139**.
- The project has five frontend stories, five capabilities and five contracts;
  its original frontend arc is closed. All five contracts say agent-reported
  passing, with storytree verification explicitly not checked.
- No `.git` exists, and Git, GitHub CLI and Node are absent from the builder's
  fresh PATH. The existing launcher borrows Node from a prior test cache.
- The first turn starts on **storytree 0.3.548**, 2026-10-02 at 17:23:22 AEST.
  [github-turn.ps1](harness/github-turn.ps1) records the app version before and
  after every turn; a changed version invalidates that turn as acceptance proof.
- The harness project list omitted both Conduit folders. It now includes them
  so state snapshots cover the projects actually under test.

## GitHub and pipeline trial

The [first prompt](harness/prompts/github-codex-1.txt) asks for a private repository
and the official frontend suite on every pull request. It explicitly authorizes
creating the repository and installing the necessary tools. Authentication is
GitHub's browser device-code flow; credentials are never supplied by the supervisor.

Codex first calls `check_setup`, completes the requested file-edit probe, then
gets a verified connection. The check preserves the existing library and does
not tell the agent to install optional tools, consistent with ADR-0751. Codex
reads the project's orchestrator and librarian, adds a CI story with one
capability and contract, and parks an increment on the existing arc.

The initial attempt to claim both increment and capability in one call is
refused. Separate calls succeed. This repeats the claim-shape friction seen in
the folder-only trial and is recorded as `friction_3c3b5e97b4bd`.

The Git installer is cancelled at Windows elevation. Codex switches to portable
Git, GitHub CLI and Node under the user's temporary directory and later stops
the stalled installer. It initializes Git in place, stages the original 32-file
frontend baseline, and adds the workflow and test configuration separately.
The original project name and library identity remain unchanged.

| First turn | Observed result |
| --- | --- |
| Wall time | 1,417 seconds, including the device-code wait |
| App version before → after | 0.3.548 → 0.3.548 |
| Existing local checks | 22 passed |
| Official suite on laptop | 138 passed, one passed on retry, zero failed or skipped |
| Upstream test provenance | All 22 vendored files match the pinned upstream source |
| CI configuration | Pull requests, pushes to main and manual runs; Node 22; pinned Playwright 1.63.0; Chromium; retained reports |
| Remote outcome at turn end | No repository or pull request yet; authentication pending |

The first sign-in code expires. Codex then requests a replacement with the
`workflow` scope needed to push Actions files, but ends its turn immediately
after displaying it. The waiting `gh` process disappears: `Get-Process gh`
returns nothing and `gh auth status` still exits 1. The supervisor therefore
starts a fresh device-code flow over SSH and keeps that command alive in the
foreground. This is `friction_481ffed235f4`. Codes and the sign-in question stay
in the private lane report and library, not this evidence.

The third code is approved and `gh auth status` succeeds at 17:58:26 AEST.
The question is settled and the [second user turn](harness/prompts/github-codex-2.txt)
asks Codex to finish publishing, verify the hosted pipeline, and make its tools
work in fresh sessions. GitHub CLI itself reports that its credentials were
saved in plain text after the SSH sign-in. The supervisor never opens or copies
the credential file. A separate operational follow-up,
`increment_3b652cfc74e1`, is parked to check the supported Windows credential-store
path; repository and pipeline work continues under the existing authorization.

Git and Node now resolve from durable per-user `Programs/ConduitTools`
locations, and GitHub CLI resolves from its installed `Program Files` location.
Codex sets the user PATH and verifies the tools from a fresh PowerShell;
the supervisor repeats that check after the trial. A project `Use-Tools.ps1`
also supports terminals that still have the old PATH. It creates the approved
**private** repository, pushes the original frontend as the baseline, and uses
a normal Git branch, `ci/official-realworld-frontend`, for the CI changes. It
does not call `make_workspace` for this increment.

**Private build PR #1 merged at 18:10:48 AEST.** Codex runs the merge itself
with GitHub CLI after the first hosted run succeeds: **139 passed, no retries,
failures or skips**, in 4.4 minutes of test execution. The supervisor checks
the repository's private visibility, the hosted log and the merged PR state
independently from Mint. Private repository links are deliberately omitted.
Codex then reports the contract green, marks and lands the CI capability,
closes its increment with PR #1, and updates the decision with the result.

The automatic post-merge run then fails **one of 139** tests after both
retries: `Navigation and Filtering › should paginate articles` counts zero
articles on the first tagged page. The saved page snapshot shows
“Loading articles…” after the test had already seen an article. Codex traces
this to sign-in restoration clearing an already loaded feed, corrects its
initial page-2 diagnosis, parks a fix increment and branches again. Its new
deterministic regression fails before it edits the app. This is a build defect
found by the pipeline; the successful PR run does not erase it.

Private build PR #2 preserves the loaded feed across auth restoration and
refreshes its favourite buttons once auth is ready. **23 local checks pass.**
It also adds those deterministic browser checks to the pipeline. Their first
Linux run fails while starting Chromium, before app assertions or the official
suite run. Codex adjusts the Linux launcher and adds startup diagnostics,
then pushes the correction to the same PR.

That run passes **23 local checks and all 139 official tests without retries**.
Automatic approval review then refuses the combined verification, merge and
branch-deletion command: it regards follow-up PR #2 as outside the first-PR
authorization. The supervisor explicitly authorizes the necessary fix through
the [third user turn](harness/prompts/github-codex-3.txt); it does not merge the
build itself.

This refusal also exposes a **supervisor harness defect**. The version wrapper
sets PowerShell's error action to `Stop`, which makes Codex's native stderr
terminate the turn before Codex can respond to the refusal. The task exits 1;
the turn metadata has no exit line, while the wrapper's `finally` records
18:33:37 and the unchanged version **0.3.548**. This turn lasted about **2,094
seconds**. The wrapper now invokes the turn in a child scope with `Continue`
so Codex can handle its own stderr. The stopped task is deleted.

The third turn exposes another harness problem: `resume --last` selects the
automatic approval-review child, not the builder. Codex warns that a session
recorded with `codex-auto-review` is being resumed with `gpt-6-astra`; approval
checks then fail because that child has no Guardian extension. The turn lasts
115 seconds on **0.3.548 → 0.3.548**, records the grading limitation in the
project library, and ends without merging. The stderr correction is proven
here: the refusal no longer kills the turn.

The harness now accepts an explicit Codex session ID, and this trial's wrapper
requires it for every resume. The fourth launch fails before Codex starts:
PowerShell unrolls a one-item array expression into a scalar and splats the
ID incorrectly. A typed string array fixes that; a native-process argument
probe confirms the intact ID and stdin marker. The [same prompt is relaunched
as turn five](harness/prompts/github-codex-5.txt), targeting the original builder
ID with automatic approval review still enabled.

The exact builder thread restores the storytree tools and approval review.
Codex merges **private PR #2 at 19:03:50 AEST**. The final post-merge pipeline
passes **139 official tests and 23 fixture checks**, with zero retries,
failures or skips. Codex closes the fix increment, lands and releases all
three capability claims, parks the Mint fixture-runner investigation, and
closes its session safe. Local `main` is clean and matches the remote; both
merged feature branches are deleted. No supervisor merge or build edit is used.

The fifth turn takes **739 seconds**, ending at 19:13:53 AEST; the app stays
**0.3.548 → 0.3.548**. All trial task entries are deleted after their runs.

## Independent grading method

Grading runs on Mint, on a copied build, using the unchanged official
`realworld-apps/realworld` suite at
`ebbcdeb8d55b42a3a613c787560498b8ef10003f` and Playwright 1.60.0. Hurl 8.0.1 is
downloaded into the supervisor's user-space trial directory and checked against
the release SHA-256. No sudo or system installation is used.

The frontend-only baseline uses `TEST_MODE=spa`. For the agent's own backend,
the official `TEST_MODE=fullstack` mode drives setup and cross-user scenarios
through the UI; its deliberate browser-mock skips are reported as skipped,
never passed. `API_BASE` includes `/api`; the Hurl runner's `HOST` does not,
because the request files append it themselves.

The independent frontend grade ran from 07:46:38 UTC for 448.5 seconds:
**138 passed, one passed on retry, zero failed, zero skipped**. The retry was
`pagination should work with /tag/:tag`: its first attempt timed out waiting
two seconds for `.article-preview`; the second passed. This is reported as
flaky, without attributing an unproven cause. The laptop's flaky comment test
passed on Mint's first attempt.

A fresh copy of PR #2's tested commit, `6c5e027`, preserves all 22 official
test files byte-for-byte. Its independent full run takes 472.1 seconds and
ends **136 passed, two passed on retry, one failed, zero skipped**. The failure
expects two articles on the newly registered user's profile and sees none.
The retry trace proves that the demo API returns different identities for the
same registration token and creates both articles under other users. The app
requests the original profile and author filter correctly; the API returns
404 and an empty article list. The trace does not identify which outside
activity causes the identity changes. The exact official case then passes
**three isolated repetitions**, in 21.8 seconds. The failed full run remains
a failed run; it is not relabelled green.

An additional check of the build's own fixture runner on Mint fails at its
first social-flow `Page.navigate` and can cascade into `Script not found`.
This occurs with Node 24.19.0 and with Node 22.16.0 plus Chromium 153 matching
CI. The fixture runner installs its fetch mock before navigation and never
forwards unmatched fetches; `CONDUIT_LIVE_TEST` is unset. No demo-API traffic
window is identified in that local check. The timeout's cause is unresolved;
it is reported separately from the official suite and from the 23 passing
hosted checks. Node 22's official archive is also SHA-256 checked and installed
only in the supervisor's user-space trial directory.

## What the app and library show

After the first turn, the library retains all five frontend stories and adds
**Review changes with official CI**. Its increment remains active. No workspace
or pull-request result has been proven at this capture because authentication
is still pending. The second turn subsequently closes that increment with
the merged PR, as recorded above.

![Conduit's five frontend stories and new CI story](shots/c919-github-forest.png)

The default sessions list shows two old sessions. The new GitHub session is
absent; `session list --all` reports it as **ended, hidden**, with no close-out,
although its increment is active and the folder has staged and uncommitted
work. This observation is recorded as `friction_e3958b554bd4`. The lower forest
labels also meet the sessions panel, continuing the known label-layout issue
from the folder-only trial.

![Default sessions list after the GitHub turn](shots/c919-github-sessions.png)

After the refused merge command terminates the second turn, the session stays
listed with its fix name and a 141.3K context reading. PR #2 is still open at
this capture; the view is not evidence of a completed close-out.

![Feed-fix session after the interrupted second turn](shots/c919-github-after-ci.png)

The final independent library read confirms both implementation increments
closed with PRs #1 and #2, no remaining claims, and the builder session
**ended, hidden, safe, verified**. This is the close-out result the earlier
folder-only build could not establish without Git. The six stories still say
agent-reported passing and explicitly state that storytree does not check
this project's tests yet. The Mint runner investigation is a proposal in
Conduit's library (`increment_8626d58a4e7d`), with no owner question or claim.

The app updates to **0.3.555 after the fifth turn ends**, at the quiet moment.
That change is outside the recorded 0.3.548 trial runs.

Screenshots contain only the app. The debug-port capture was taken between
builder turns; the app was then restarted normally and port 9222 was confirmed
closed. All capture tasks were deleted.

## Landing notes

The librarian pass corrects the trial arc's stale request for repository
approval and the increment's stale empty-folder objective. The owner's
existing-project and private-repository instructions are preserved as the
authority. The sign-in question is settled with the observed approval. No
accepted decision needs a new decision or a correction.

The Windows-driving process note (`process_81a7122f6849`) is amended in place:
resume the captured builder ID, preserve a typed argument array in PowerShell,
and allow Codex to handle native stderr within the version wrapper. Its
read-back and history verify the change. These observations improve the
supervision harness; they are not Conduit implementation changes.

The friction drain is empty. The health drain briefly offers the website's
publish-on-merge capability; its named test has already landed in PR #519,
and fresh reads return an empty worklist. No duplicate fix is opened. The
three trial frictions above remain for another landing to adjudicate.

This first evidence landing proves GitHub and the frontend pipeline. The
backend API and frontend-against-own-backend grades have **not run yet**.
The [backend requirements](harness/conduit-backend-requirements.md) are the
user file prepared for the next, fresh Codex session.

The folder-only Codex build took 5,281 seconds over eight turns. This trial's
GitHub work additionally includes installation, browser approval and hosted-CI
waits, so elapsed times are not a like-for-like measure of building speed.
Its three builder turns take 4,250 seconds; the mistakenly resumed review
thread adds 115 seconds, for 4,365 seconds total. The argument-binding failure
does not start a Codex turn.
Codex billing cost is not reported by the ChatGPT-plan CLI, as in that trial.
