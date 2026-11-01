# storytree

A living map of your project, for you and your agents. Here is storytree's own map, growing as its agents built it:

https://github.com/user-attachments/assets/ce6b08a0-4aa3-49a8-9ccc-cdc2ba79025d

> **Early alpha: not ready for use yet.** Storytree is built in the open, and this repository is where you can
> follow it. It changes daily, its releases are unsigned, and things break. Watch or star the repository to follow
> along; install it only if you are happy to hit rough edges.

## Official sources

Storytree has two homes and no others: this repository,
[github.com/storytree-ai/storytree](https://github.com/storytree-ai/storytree), and
[storytree.dev](https://storytree.dev). Its maintainer is [@HuaMick](https://github.com/HuaMick).

- Installers come only from this repository's
  [Releases](https://github.com/storytree-ai/storytree/releases), through one one-liner per
  platform. On Windows, in PowerShell:

  ```powershell
  & ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.ps1')))
  ```

  On a Mac or Linux, in a terminal:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh
  ```

- Storytree is not published on npm, PyPI, Homebrew, winget, Docker Hub or any MCP registry. A
  package there under its name is not ours.
- Maintainers never send download links in issues, email or direct messages.
- To check a download by hand, compare its SHA-256 with the `sha256:` digest GitHub shows beside
  that file on the [release page](https://github.com/storytree-ai/storytree/releases):
  `Get-FileHash <file> -Algorithm SHA256` in PowerShell, `shasum -a 256 <file>` on a Mac,
  `sha256sum <file>` on Linux. The one-liners make this check for you.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Install

You need Windows x64 (an arm64 build is included but not yet tested) and Claude Code or Codex,
installed and signed in. In Windows PowerShell (5.1+) or PowerShell 7, run:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.ps1')))
```

It installs the app and opens it. Then open **Help → First-run guide** in the app to connect your
agent. What the command does and checks: [apps/desktop/README.md](apps/desktop/README.md).

This release is unsigned. If Windows shows a SmartScreen warning and you trust the download, use
**More info → Run anyway**. If Windows says **Smart App Control** blocked it and offers no Run
anyway, that is Windows 11's reputation check on unsigned apps. See whether it is on in Windows
Security → App & browser control → Smart App Control settings. Turning it off there lets storytree
install, but Smart App Control then stops checking every app on the computer (Defender antivirus
keeps running). On Windows 11 with the April 2026 update or later you can turn it back on from the
same page; before that update, turning it back on needs a reset or reinstall of Windows. If you
would rather keep it on, wait for a signed release.

**Storytree 0.3.** Storytree is the observability layer beside your coding agent. You build a
project with Claude Code or Codex, and storytree shows you what is being built: each project as a
forest that grows as stories land, an arc surface for what is planned, in progress and done, and a
plain-language view of how each story works and whether it is healthy. Health shows what your agent
*reported*, labelled as the agent's report. Storytree does not yet check your project's tests
itself: so far it checks only its own project's tests, and shows what it found separately.

Once it is installed, **Help → First-run guide** in the app covers setup, connection checks, the
offline license and feedback. Help is available before you have a project and while viewing any
forest.

## Keys

Storytree borrows the logins you already have (Claude Code or Codex, `gh`, Google sign-in), so most
people never give it a key. When a feature does need one, save it once, typed or piped in, never
as an argument:

```sh
storytree auth set anthropic      # then type or paste the key; nothing is shown
storytree auth list               # names and where each comes from, never the values
storytree auth remove anthropic
```

The app, the command line and the agent's tools all find it. It is kept in `auth.json` in
storytree's home (`~/.storytree/0.3`, or `STORYTREE_HOME`), readable only by you. A key given on a
command wins over the saved one, and the saved one over its environment variable (such as
`ANTHROPIC_API_KEY`).

To keep a key in your own store instead, save a command that prints it, starting with `!`.
Storytree runs it once per process when the key is needed:

```sh
echo '!op read op://Private/Anthropic/credential' | storytree auth set anthropic
echo '!gcloud secrets versions access latest --secret=anthropic-key' | storytree auth set anthropic
```

A library reached by a Postgres address keeps its password the same way, as the key `postgres`,
never in the address:

```sh
storytree settings set library postgres 'postgres://me@db.example.com:5432/postgres?sslmode=require'
storytree auth set postgres       # then type or paste the database password
```

### Keys on CI

A CI runner starts fresh every run, so it has no `auth.json` and storytree keeps nothing for it.
Put each key in the CI platform's own secret store and hand it to the job as an environment
variable, which storytree reads last in its order. For a library reached by address, that is
`PGPASSWORD` (GitHub Actions shown):

```yaml
- run: storytree settings set library postgres "postgres://ci@db.example.com:5432/postgres?sslmode=require"
- run: storytree arc list
  env:
    PGPASSWORD: ${{ secrets.STORYTREE_LIBRARY_PASSWORD }}
```

Better still, use no key at all. For a library on Cloud SQL, let the job sign in to Google as a
service account through workload identity federation: the service account has the Cloud SQL
Client and Cloud SQL Instance User roles and is a database user of type
`CLOUD_IAM_SERVICE_ACCOUNT` on the instance, named by its email without `.gserviceaccount.com`.

```yaml
permissions:
  id-token: write   # GitHub's OIDC token, for the keyless sign-in
steps:
  - uses: google-github-actions/auth@v3
    with:
      workload_identity_provider: ${{ vars.WIF_PROVIDER }}
      service_account: ci@my-project.iam.gserviceaccount.com
  - run: storytree settings set library cloudsql my-project:australia-southeast1:my-instance ci@my-project.iam
  - run: storytree arc list
```

## Reporting an error

If storytree shows you an error, ask your agent to submit a GitHub issue on this repository,
[`storytree-ai/storytree`](https://github.com/storytree-ai/storytree/issues), and it will be worked
on. That is the current workflow; the desktop app's error box says the same (ADR-1119).
A security problem is the exception: report it privately, as [SECURITY.md](SECURITY.md) says, never
in a public issue.

## Where this stands

Each of 0.3's stories has its own package (see How changes land), and all of them are planned in
0.3's own library (below). The first story built was the **library**, the project-scoped store
behind the app, the agent's tools and the command line. It holds the plan of work (arcs, stories,
capabilities, contracts), each item's health, and what the project has learned. It keeps one
database per project: on a local Postgres by default, or on Google Cloud SQL or any Postgres
server named by its address (see Keys).

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
(`packages/dev-loop`: the test runner, its scoping and the gate decide how every test runs, ADR-0805). Its
first line says which, as `scope: ...`; `pnpm run test --full` runs everything anyway, and after a
failure `pnpm run test --rerun-failed` runs only the packages that failed. This
`pnpm run <script> --flag` form works in every shell; Windows PowerShell 5.1 drops a bare `--`.

When an increment lands, `pnpm test-ratio` prints how many lines of test code there are for each
line of implementation, overall and per package, counting code lines only. A rising ratio is a
prompt to check that each test still protects something the product does. It is never a failure.

## Generations

- **0.1**: the original Rust project.
- **0.2**: the TypeScript storytree, frozen, at
  [`storytree-ai/storytree02`](https://github.com/storytree-ai/storytree02). Since 2026-09-28,
  0.3 has been developed from sessions started in this repo, not in 0.2's (ADR-0745), and its plan
  has lived only in 0.3's own library since cutover. 0.2 is a read-only reference: 0.3 ports its
  behaviour, and its code is never copied wholesale.
- **0.3**: this repo, a stripped-down rebuild with its own desktop app and its own local database.

## License

Storytree is **open source**, licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).
Anyone, businesses included, may use, modify, embed and redistribute it, including in products of
their own, under that license's terms.
