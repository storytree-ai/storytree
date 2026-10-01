# A dev build connected to a throwaway Codex home, with one command (2026-10-02)

A live Codex (or Claude Code) check against a dev build used to need a rig built by hand on each box: a
throwaway Postgres, the built commands, a fake HOME and CODEX_HOME, the tool-server table and the AGENTS.md
section (two such rigs were kept, in `../codex-review-repro` and `../codex-hardening-live`; both are retired).
Now, from a checkout:

```sh
pnpm --filter @storytree/app-setup dev-home /tmp/st-devhome-codex --codex     # add --claude for Claude Code
. /tmp/st-devhome-codex/env.sh                                                 # env.ps1 in PowerShell
mkdir /tmp/st-devhome-codex/folder && cd /tmp/st-devhome-codex/folder
storytree doctor --set-up cx-dev
codex exec --skip-git-repo-check --approve-for-me --dangerously-bypass-hook-trust "Make a hello.txt file here that says hi."
pnpm --filter @storytree/app-setup dev-home /tmp/st-devhome-codex --remove      # stops its database, deletes it all
```

It builds the dev build's commands into `<dir>/tools`, makes a fresh home under `<dir>/home` (copying only the
agents' sign-in from the user's own `~/.codex` / `~/.claude`), and connects the chosen agents there with the same
code an installed storytree's `setup connect` runs. The home's own Postgres starts on demand, the way a storytree
command opens a closed app: its `app.json` names `dev-database.ts`. `--remove` refuses a folder it did not make.

## Run on the Mint box, Codex 0.153.4 signed in

- `dev-home --codex`: "codex: tools connected; hooks waiting for you to trust them in Codex", under a second.
- `storytree doctor --set-up cx-dev` in a fresh folder started the home's own Postgres and set the folder up.
- One Codex session (`codex-session.txt`): storytree's hooks ran from the dev build, the session called
  `check_setup`, `search_notes`, `open`, `show_plan` and `close_out` against the throwaway library, and made
  `hello.txt`. `storytree doctor` afterwards: "Codex runs storytree's hooks: one has reached storytree since
  they were registered … This folder is storytree project "cx-dev"."
- A first try without `--approve-for-me` stopped at "MCP tool call requires approval, but approval policy is
  never": `codex exec` needs it (or an interactive session) to call storytree's tools.
- `dev-home --remove` stopped the database (no process left) and deleted the folder. The owner's `~/.codex`
  and library were only read (the sign-in) or not touched.
