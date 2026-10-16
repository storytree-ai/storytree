# App setup: Linux acceptance, the automated floor, on a GitHub Ubuntu runner (increment_46e44175295b)

The Linux twin of `../mac-acceptance/`. `harness/run.sh` runs on a fresh `ubuntu-latest` runner, started by
`.github/workflows/linux-acceptance.yml` (dispatch it, or push to a `linux-acceptance/` branch). The release workflow
calls it after every publish that carries a new Linux build, on the development channel, and `harness/judge.sh` fails
it unless the install exits 0, the AppImage is in `~/.local/share/storytree-0.3` at the version just published (the
pipe hides a 404), the app and its Postgres are running, the setup check exits 0 and Claude Code's hooks are written.
Its verdicts are in `verdict.tsv`, in the run's `linux-acceptance` artifact; those runs are not committed here.

What a runner lacks and a desktop has is added first: a virtual display (Xvfb, with openbox placing windows), libfuse2
(`libfuse2t64`, the package the installer names when it is missing) and `expect`, which answers the one-liner's
questions as a person would: 1 (connect Claude Code, installed from npm and never signed in), Enter for the folder,
Enter for the suggested name. The kernel's sandbox setting is left as the runner has it. A desktop login reads
`~/.profile`, where the installer puts the command's PATH line, so the terminal steps read it too: the runner's login
bash would read its own `~/.bash_profile` instead. No secret is used, and no agent is signed in: the logs are public.

The hands-on run on the Mint box, with real sign-ins and a self-update, is increment_82aae96c8be3; it waits on the
owner's question_04162e84a6ef.

## Runs of 2026-10-16

Runner: Ubuntu 24.04.5 LTS, `apparmor_restrict_unprivileged_userns=1` (as on a stock Ubuntu desktop, so Chromium's
sandbox cannot run unprivileged there). Both runs installed development 0.3.1483 in 13 to 15 s.

- Run 38905389729: **FAIL** on the harness, not the app. Everything came up, but the terminal steps used a login bash,
  which read the runner's `~/.bash_profile` and never `~/.profile`, so `storytree` was not on PATH (exit 127).
- Run 38905630756: **PASS**, every judged check. First open showed the app's window on its first-run guide, titled
  with the project and version; the app runs with `--no-sandbox` and its Postgres from the AppImage's mount; the
  setup check says storytree is running, Claude Code's hooks are registered, the folder is a project and the command
  is on PATH; an arc and a story were written and read back with no agent.
