# Landings

One row per landing of the parallel rebuild: round, lane (the Claude Code session that landed it), shop pull
request, merge time and commit, and the grade of `main` after it. Lanes in one round ran at the same time.

| Round | Lane (session) | Shop PR | Merged (UTC) | Merge commit | What | Grade of main after |
|---|---|---|---|---|---|---|
| R1 | part 1 (3586b7d0) | #1 | 2026-10-04T05:58:29Z | 1aa16169 | part 1: server, sign in, Products; all four story packages and the shared cart store made up front | official 3/4 (locked-user sign-in flaky: 3 of 5 runs) |
| R1 follow-up | part 1 (3586b7d0, resumed) | #2 | 2026-10-04T06:28:40Z | 94711ca5 | sign-in errors shown in the page, without a page load | **official 4/4**; login spec 5/5 runs |
