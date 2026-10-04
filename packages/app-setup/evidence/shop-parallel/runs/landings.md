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
| R4 | part 6 (a670a873) | #6 | 2026-10-04T07:33:30Z | 162381db | part 6: orders saved at Finish, My Orders, order page | — |
| R4 | part 9 (f88b0fc1) | #8 | 2026-10-04T07:35:46Z | ae7ded5a | part 9a: stock, admin prices, the admin page | — |
| R4 | part 5 (3437a351) | #7 | 2026-10-04T07:40:21Z | 471c5be6 | part 5: sign up, greeting, `/api/me`; merged main into its branch twice | — |
| R4 | part 9 (f88b0fc1) | #9 | 2026-10-04T07:41:40Z | 57b914e5 | part 9c: stock off at Finish, once part 6 had landed | — |
| R4 | part 9 (f88b0fc1) | #10 | 2026-10-04T07:45:03Z | 18875b56 | part 9b: `admin_user` and the Admin link, once part 5 had landed | official **26/26**; ours 19/29 = parts 5, 6, 9 in full (7 and 8 not yet built) |
| R5 | part 7 (c3831547) | #11 | 2026-10-04T08:06:37Z | 9ea3d5d4 | part 7: search | — |
| R5 | part 8 (83723b4f) | #12 | 2026-10-04T08:11:46Z | 96af3d05 | part 8: reviews; merged part 7 into its branch first | official **26/26**; ours **29/29** |
