# The agent link's live check, as an acceptance run (setup check 8.6, ADR-0825 D5)

Setup check 8.6: a real Claude Code session and a real Codex session, each in a new empty folder set up as a project
(`storytree doctor --set-up`), told "Add a sign-up form, with tests.", show up live, plan, claim, report red then green
and land, and the activity log and the library show all of it; a second session that ignores storytree and only edits
a file shows up as unplanned activity. The harness, never a model, mints the verdict; `pnpm record:acceptance
<observations.json>` writes it to the verified column as "acceptance run".

## The journey (harness/)

- `journey.sh <dir> <out> <step>…` makes a throwaway home with app setup's `dev-home` (its own HOME, agent homes,
  storytree home and Postgres; nothing of the owner's library), then runs each step: `claude-code` or `codex` (a new
  folder, `storytree doctor` before, `doctor --set-up`, one session told "Add a sign-up form, with tests.", `doctor`
  after) and `unplanned` (in the Claude Code project, one Claude Code session on haiku told to ignore storytree and
  only append a line to `notes.txt`). Codex runs with `--approve-for-me`, and `--dangerously-bypass-hook-trust` standing
  in for the user trusting storytree's hooks in `/hooks`; Claude Code runs with `--dangerously-skip-permissions`.
- `observe.mjs <dir> <out> <commit>` reads only what storytree recorded, in the throwaway home's library and activity
  log, and what `storytree doctor` said; the sessions' replies (`*-session.txt`) are kept and never read. Each agent's
  lines are those after its session started; the unplanned session's, those between its start and end.

## Run of 2026-10-02 (2026-10-02/), the Mint box

Linux, this checkout's dev build at 1173ce2d (main), Claude Code 2.1.284 (its default model) and Codex 0.153.4
(gpt-6-astra), both signed in.

| Contract | Verdict | What the harness saw |
|---|---|---|
| 8.6 the live check | **passing, 17/17** | For each agent: the folder was not a project before and was after; its session started in the activity log from that agent; the library holds the story, capability and contract it planned; the log has its claim; one contract was reported red, then green; it landed its capability; the log shows its work (Claude Code: 6 commands, 4 counted toward its claim; Codex: 3 edits and 13 commands, 6 counted toward its claim). The second session's one edit shows up counted toward no planned work. |

How the run went, so a later run can compare:

- **Codex** (`codex-*`) planned an arc, story, capability and contract and parked an increment, claimed the capability,
  reported its contract red then green, landed it and called `close_out`; 10 tests and a server smoke check pass in its
  folder. Its first session in the folder called `check_setup` first.
- **Claude Code** (`claude-code-*`) planned a story, capability and contract, claimed, reported red then green, landed
  and marked it built; 14 tests pass. It wrote its files with shell commands, not its edit tool, so the log holds them
  as commands run, not file edits. The observer's first version counted only file edits and failed this one check; it
  now counts both, and the detail says which.
- **Claude Code's first attempt** (`claude-code-attempt1-*`) never started: it refused with "Failed to refresh OAuth
  token". The first `dev-home` copied `~/.claude/.credentials.json` into the throwaway home; the unplanned session
  then refreshed that copy, which ended the box's own `~/.claude` sign-in ("OAuth session expired and could not be
  refreshed") until the refreshed copy was moved back (it works again). `dev-home` no longer copies Claude Code's
  sign-in (see `packages/app-setup/evidence/dev-home`); the counted session ran with `CLAUDE_CODE_OAUTH_TOKEN`, as the
  box's lanes do. The unplanned session's own result is unaffected: it ran, and its edit is what the check reads.
- **Not exercised**: the installer's folder step (`doctor --set-up` stood in, which the contract allows), Windows and
  macOS, and a user trusting Codex's hooks by hand. The reset-laptop round (increment_44bd7a583f32) runs the installed
  build on Windows.

## Left on the box

`dev-home --remove` stopped the throwaway home's Postgres and deleted it, with the trial folders; `~/.codex/auth.json`
was never refreshed inside (unchanged). Claude Code keeps each session's transcript under `~/.claude/projects` by
folder only when it runs with `~/.claude`; these ran with the throwaway `CLAUDE_CONFIG_DIR`, so nothing was left there.
