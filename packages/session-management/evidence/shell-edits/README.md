# Shell writes count as edits

Increment `increment_14b1f20436b4`; Hooks contract 3.22 (`contract_334e37afd226`).

Measured on Mint, 2026-10-06 Sydney time, against checkout `47e2f49a` (4,698 tracked
files, 421,250,381 bytes). Twenty reads of Git status took a median 10.89 ms;
twenty reads of the committed file hashes took 6.80 ms. Status alone cannot
distinguish a second write to a file already marked modified. Reading all file
contents would needlessly revisit 421 MB each command.

The implementation reads the index's hashes, then hashes only dirty and
non-ignored untracked files with Git, preserving its text normalization. Twenty-one
calls of the complete observer in the dirty implementation checkout took 28.22 ms
on the first observation, then a median 28.69 ms and maximum 32.98 ms. It makes no
database reads. Snapshots live under the storytree home, per session and worktree.
Each Git operation has a one-second timeout and an 8 MB output limit; a failed
observation keeps the last good baseline and leaves ordinary hook lines intact.

The red run of the built hooks saw only the explicit edit for each harness,
missing all seven shell-write events in the first version of the test. The green
test sends real recorded-shape hooks around Node commands, for Codex Bash and
Claude Code PowerShell, while storytree is offline. It covers repeated writes,
new files, deletion and restoration of a tracked file, moves, failed commands,
and a write committed before the after-hook. Pre-existing dirt, ignored files,
read-only commands, staging, unchanged commits and an explicit tool edit do not
invent another edit. Git-normalized CRLF content remains unchanged when committed.
On reconnection the queued edits reach the log with session, worktree and branch;
the existing upkeep operation claims the file's capability from those lines.

The first observation establishes a baseline. As an observer between hook events,
this cannot identify changes undone before the next observation, writes outside
the hook's Git worktree, or distinguish simultaneous writers sharing one worktree.
Ignored generated files and nested repositories are outside this observation.
Separate worktrees retain separate baselines, including before their first commit.
These limits do not change the existing claim lookup or its notices (ADR-0924).
