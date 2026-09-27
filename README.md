# storytree

**Storytree 0.3.** Storytree is the observability layer beside your coding agent. You build a
project with Claude Code or Codex, and storytree shows you what is being built: each project as a
forest that grows as stories land, an arc surface for what is planned, in progress and done, and a
plain-language view of how each story works and whether it is healthy. Health shows what the agent
*reported* separately from what storytree *verified* for itself.

## Where this stands

This repo is new. Its first story is the **library**: the project-scoped store every later story
reads and writes. It holds the plan of work (arcs, stories, capabilities, contracts), each item's
health, and what the project has learned. It runs on a local Postgres, with one database per
project and an optional Google Cloud connection. Its capabilities are listed in
[`stories/library.md`](stories/library.md).

## This repo's own library

Storytree 0.3 keeps its own plan in the kind of library it gives every project. `pnpm seed:library`
loads this repo's stories ([`stories/`](stories)) and the decisions made for them
([`decisions/`](decisions)) into the desktop app's library, as the project `storytree`. Each
decision becomes a front cover of the one story or capability it decided; a decision about the
whole project sits on no shelf, and is found by search. The seed then runs each story's own tests
and records what they showed as its verified health. The app need not be quit: while it runs, the
seed writes into its database; otherwise the seed starts the app's own Postgres itself. A seed
waits its turn behind another, and the app never restarts into an update while one is writing.
Running it again updates everything in place and never adds anything twice.

## How changes land

Every change reaches `main` through a pull request. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) installs, typechecks and runs the tests on
Linux, macOS and Windows, against the merge of the branch with `main`, and merges the pull request
once they pass on all three. `main` is protected, so nothing merges without that check. A draft pull
request is never merged: open one as a draft to hold it. Storytree ships for Windows first; the
macOS run keeps the code working on a Mac as it is written, so Mac support later is packaging, not
porting.

Each story keeps its code in its own package, `packages/<story>`. `packages/app` and
`apps/desktop` are the frame, and `packages/cli` is the front door; both stay thin. `pnpm test`
fails a change that adds a story with no package, puts story code in the frame or the front door,
or reaches into another story's package files. The rules and the declared shared engines are in
[`scripts/package-boundaries.mjs`](scripts/package-boundaries.mjs) (ADR-0649 D1-D3, in 0.2's
decision log).

`pnpm test` runs only what a change can reach, locally and in CI alike: the packages holding a file
changed since the branch left `main`, plus every package that depends on them. A change it cannot
place in a package (a root file, a `package.json`, the lockfile, `scripts/`) runs everything. Its
first line says which, as `scope: ...`; `pnpm test -- --full` runs everything anyway, and after a
failure `pnpm test -- --rerun-failed` runs only the packages that failed.

When an increment lands, `pnpm test-ratio` prints how many lines of test code there are for each
line of implementation, overall and per package, counting code lines only. A rising ratio is a
prompt to check that each test still protects something the product does. It is never a failure.

## Generations

- **0.1**: the original Rust project.
- **0.2**: the TypeScript storytree, frozen, at
  [`storytree-ai/storytree02`](https://github.com/storytree-ai/storytree02). It is the tool that
  builds 0.3, and its behaviour is the reference 0.3 ports from. Its code is never copied wholesale.
- **0.3**: this repo, a stripped-down rebuild with its own desktop app and its own local database.

## License

Storytree is **source-available**, not open source: it is licensed under the
[PolyForm Shield License 1.0.0](LICENSE). Anyone, businesses included, may use, modify and embed it;
the one thing the license does not allow is providing a product that competes with storytree.
Competing use needs a separate grant from the owner.
