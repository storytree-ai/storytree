# Contributing to storytree

This page is for people working on storytree itself. To use storytree, start from the
[README](README.md). An agent opened in a clone of this repository takes on storytree's own
development guidance ([CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md)), which this page sums up
for people.

## Where this stands

Each of 0.3's stories has its own package (see [How changes land](#how-changes-land)), and all of them are planned in
0.3's own library (below). The first story built was the **library**, the project-scoped store
behind the app, the agent's tools and the command line. It holds the plan of work (arcs, stories,
capabilities, contracts), each item's health, and what the project has learned. It keeps one
database per project: on a local Postgres by default, or on Google Cloud SQL or any Postgres
server named by its address (see [Keys](docs/keys.md)).

## This repo's own library

Storytree 0.3 keeps its own plan in the kind of library it gives every project, and the library is
its only copy (ADR-0641, in 0.2's decision log). Since 2026-10-08 that library is Postgres 16 on
the Mint box (ADR-0928), shared by every machine that develops 0.3, and its project `storytree` holds 0.3's own
stories, their capabilities and contracts, the notes filed behind their front covers, and the
decisions made for them. Sessions plan and edit them through the storytree tools, as a user's agent
does, and an edit is live when it is written. There are no story or decision files to edit, with
one exception: a factory plugin's story is written from the plan file the plugin carries, through
`storytree plugin import-plan` (ADR-1187), so the library still holds one set of its capabilities
and contracts, but their source is the plugin's file, and the plan edits refuse them.
`pnpm storytree settings show` says which library a machine uses, and each script below uses that
library (the app's local one, one on Cloud SQL, or one at a Postgres address) and says which.
`pnpm library:export`, `pnpm library:restore` and `pnpm record:acceptance` run Mick's factory plugin
(`storytree library-tools …`), so they work only on a computer that names it.

- `pnpm library:export` prints the project `storytree` as read-only story and decision files into
  `library-export/` (which git ignores), for reading the plan outside the app.
- `pnpm check:own-health` runs each story's own tests and records what they showed as its verified
  health. CI also runs it on `main` after merges, recording into storytree's own library on the Mint
  box over Tailscale ([`.github/workflows/own-health.yml`](.github/workflows/own-health.yml)).
- The app keeps a snapshot of every project, taken at start and once a day, in
  `~/.storytree/0.3/backups/`. `pnpm library:restore <snapshot> [--project <name>]` puts one back,
  only into an empty project, so it never overwrites live edits.

A script that uses the app's local library joins the running app's database, or starts it when the
app is not running, and waits its turn behind another script, so there is no need to quit the app.

Since cutover (2026-09-27) the plan lives here too: 0.3's arcs, their increments and the owner's
questions. `pnpm storytree …` is 0.3's command line run from this checkout, whose `.storytree/project.json`
names the project `storytree`. It reaches the library the `library` setting names: one on Cloud SQL
or at a Postgres address with no app needed, and the app's local library only through the running
app, which it does not start. `pnpm storytree arc list` reads the plan, and `pnpm storytree
workspace <increment> --reason …` claims a piece of it.

## How changes land

Every change reaches `main` through a pull request. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) installs, typechecks and runs the tests on
Linux, macOS and Windows, against the merge of the branch with `main`. Once they pass on all three,
it hands the pull request to GitHub's merge queue, which runs them again on top of `main` and the
pull requests ahead of it, and merges it only if they pass there too (ADR-0796). `main` is
protected, so nothing merges without that check. A draft pull request is never merged: open one as
a draft to hold it. Storytree ships for Windows first; the macOS run keeps the code working on a Mac
as it is written, so Mac support later is packaging, not porting.

Each story keeps its code in its own package, `packages/<story>`. `packages/app` and
`apps/desktop` are the frame, and `packages/cli` is the front door; both stay thin. `pnpm test`
fails a change that adds a story with no package, puts story code in the frame or the front door,
or reaches into another story's package files, and no package belongs to no story. The rules and
the declared stories are in [`packages/repo-checks/src/package-boundaries.mjs`](packages/repo-checks/src/package-boundaries.mjs)
(ADR-0649 D1-D3, in 0.2's decision log, narrowed by ADR-0805: no shared engines).

`pnpm test` runs only what a change can reach, locally and in CI alike: the packages holding a file
changed since the branch left `main`, plus every package that depends on them. A change it cannot
place in a package (a root file, a `package.json`, the lockfile) runs everything, and so does a change to the dev loop
(`packages/base-dev-loop`, and `packages/repo-checks`, storytree's own entries to it: the test runner, its scoping and
the gate decide how every test runs, ADR-0805). Its
first line says which, as `scope: ...`; `pnpm run test --full` runs everything anyway, and after a
failure `pnpm run test --rerun-failed` runs only the packages that failed. This
`pnpm run <script> --flag` form works in every shell; Windows PowerShell 5.1 drops a bare `--`.

When an increment lands, `pnpm test-ratio` prints how many lines of test code there are for each
line of implementation, overall and per package, counting code lines only. A rising ratio is a
prompt to check that each test still protects something the product does. It is never a failure.
It is the owner's factory plugin's (`storytree coverage ratio`), so it runs only on a computer that
names that plugin.

## Generations

- **0.1**: the original Rust project.
- **0.2**: the TypeScript storytree, frozen, at
  [`storytree-ai/storytree02`](https://github.com/storytree-ai/storytree02). Since 2026-09-28,
  0.3 has been developed from sessions started in this repo, not in 0.2's (ADR-0745), and its plan
  has lived only in 0.3's own library since cutover. 0.2 is a read-only reference: 0.3 ports its
  behaviour, and its code is never copied wholesale.
- **0.3**: this repo, a stripped-down rebuild with its own desktop app and its own local database.
