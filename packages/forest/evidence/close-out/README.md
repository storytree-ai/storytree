# Sessions list: close-out, the header count and the idle fold (ADR-0758; forest 7.9-7.11)

The real desktop page (built by `../sessions-list/build.mjs`) with synthetic activity: eight sessions, the same in both builds.
`capture.mjs` renders it; `CAPTURE_DIST`/`CAPTURE_AS=before` renders the same activity with the build from `main` before
this change (at #252, where the agent link already reads close-outs but the list does not use them). Run through
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` (use the absolute checkout path).

- `before-list.png`: the control. The header says 8: every session that has not ended, including one whose close-out
  was verified (fix-typo) and three quiet for 40-55 minutes.
- `after-list.png`: the header says 4 (one working, one whose turn just ended, two needing you). The verified close-out
  is gone. "fix-login" said safe, but its branch is unmerged: "needs you", with the disagreement under it. The session
  on main said not safe: "needs you", with its why. The three quiet sessions fold into "3 idle", collapsed.
- `after-idle-open.png`: "3 idle" opened: the quiet sessions listed dimmed beneath it.
