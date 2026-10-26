# What a stable acceptance run must show (increment_82ef0ee2a9c9, ADR-1032 D6)

You are the judge of one acceptance run of storytree, a desktop app with tools for coding agents. A fresh Windows user
on the old laptop installed one build with the stable one-liner, opened the app, connected Claude Code, and a
model-driven user (a headless Claude Code session given a user's goal) built a small project, then wrote feedback that
the run put into the app's Send feedback page. You did not take part in the run. Judge only from the evidence in this
folder, and say which file shows each thing. When the evidence does not show a criterion, it fails.

The evidence (paths relative to this folder):
- `version`: the build under test. `installer`: where the one-liner came from.
- `ev/install.transcript.txt`: the one-liner, answered as a first user answers it.
- `ev/shots/*.png`: the app's own window at set moments (first open, after the build, the feedback page).
- `turn-1.summary.json`, `turn-2.summary.json`: each user turn's outcome, time, cost, tool calls, refusals and last
  reply; `ev/turn-N.jsonl` are the full transcripts and `ev/turn-N.meta.txt` the app's version before and after.
- `ev/tests.txt`: the project's tests, run again by the run itself with the command the user named.
- `ev/library-tree.txt`, `ev/library-arcs.txt`: what storytree's library holds for the project afterwards.
- `ev/project-files.txt`: the project's files. `run.log`: each phase's output, including what the run did on the app's screens and what they said.
- `state-diff.txt`: how the laptop differs from before the run (empty means as it was).

The criteria, each PASS or FAIL:
1. INSTALLED AND STARTED: the one-liner installed exactly the build in `version` and ended without error, and the app
   opened (a screenshot shows it, and the turn meta files name the same version before and after each turn).
2. AGENT CONNECTED: in turn 1, the agent ran storytree's connection check and it reported the connection working
   (hooks verified, or the check's own words that it is connected); storytree tools were called during the build.
3. PROJECT BUILT, TESTS PASS: the project the user asked for exists, and `ev/tests.txt` shows its tests passing when
   the run ran them again (a non-zero exit, a failure count above zero, or no tests found fails this).
4. BUILT THROUGH STORYTREE: the library holds the project's plan (at least one story or capability, or an arc with an
   increment) that the agent wrote during the build.
5. FEEDBACK LEFT: the user wrote feedback and the app's Send feedback page took it (the run's record shows the page's
   status after Open GitHub draft; the run never submits the issue). The run's user has never signed in at the
   desktop, so Windows has no browser set for it and refuses to open any link: a status saying the draft could not be
   opened, offering to copy the prepared text, with the title and message shown in the form, counts as taken.
6. NOTHING NEEDED A PERSON: no turn ended asking the user to do something before the work could finish, no turn
   ended in an error, and no refusal stopped a step the goal needed.
7. LEFT AS FOUND: in `state-diff.txt`, no line from `st-users` down differs (those are the run's own: its user,
   task, run folder and logon right). Lines above it are the owner's install and agent settings: the run's user, a
   standard user, cannot write them, and the owner's own app may change them during the run (an update re-registers
   its hooks), so report any such change but do not fail on it.

Answer with a short paragraph per criterion, citing files, then end with exactly one line:
VERDICT: PASS
or
VERDICT: FAIL: <the criteria numbers that failed, and in a few words why>
PASS only when all seven pass.
