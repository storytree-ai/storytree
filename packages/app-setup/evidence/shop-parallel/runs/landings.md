# Landings

One row per landing of the parallel rebuild: round, lane (the Claude Code session that landed it), shop pull
request, merge time and commit, and the grade of `main` after it. Lanes in one round ran at the same time.

| Round | Lane (session) | Shop PR | Merged (UTC) | Merge commit | What | Grade of main after |
|---|---|---|---|---|---|---|
| R1 | part 1 (3586b7d0) | #1 | 2026-10-04T05:58:29Z | 1aa16169 | part 1: server, sign in, Products; all four story packages and the shared cart store made up front | official 3/4 (locked-user sign-in flaky: 3 of 5 runs) |
| R1 follow-up | part 1 (3586b7d0, resumed) | #2 | 2026-10-04T06:28:40Z | 94711ca5 | sign-in errors shown in the page, without a page load | **official 4/4**; login spec 5/5 runs |
| R2 | part 4 (de0fbc58) | #3 | 2026-10-04T06:59:48Z | 5e57571b | part 4: checkout's three pages, in `packages/checkout` only | — |
| R2 | part 2 (72cbaf46) | #4 | 2026-10-04T07:00:58Z | ba4bbfbc | part 2: product page, sorting, cart buttons and badge, in `packages/browsing` only | — |
| R2 | part 3 (182c4d96) | #5 | 2026-10-04T07:06:32Z | 1baebe6a | part 3: Cart page and menu, in `packages/cart` only; tested with parts 2 and 4 merged in first | **official 26/26**, the ceiling |
