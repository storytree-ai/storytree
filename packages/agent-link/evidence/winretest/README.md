# Why the session-start question now says "end your turn"

Windows retest, round 2 (v0.3.249, factory-reset laptop, Claude Code 2.1.283, Git-less). With #213 the first
session after install does get the start hook's instruction, but the agent did the task first and asked after
(`packages/app-setup/evidence/acceptance-retest/round-2/claude-1.txt` on the retest evidence PR).

A/B on the laptop, same prompt ("Create a file named hello.txt containing the word hi."), each in a fresh empty
folder, user settings switched off (`--setting-sources local`) and a stand-in start hook printing the context:

- A, the current text (`ctx-A-current.json`): 3 of 3 created the file first (`ab-A*.txt`).
- B, the new text (`ctx-B-new.json`): 3 of 3 asked first and created nothing (`ab-B*.txt`).

`ab-summary.txt` is the run's own tally.
