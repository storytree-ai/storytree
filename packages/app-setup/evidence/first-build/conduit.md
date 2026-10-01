# Conduit on a new user's laptop: the long build (arc_424dae58bf1b)

The laptop's own Claude Code and Codex build Conduit (the RealWorld Medium.com clone) in two storytree projects,
`conduit-claude` and `conduit-codex`, one page group per fresh session, against the public demo API. Each
session is graded off the laptop by the official RealWorld end-to-end suite (`grade-conduit/`, suite
`realworld-apps/realworld@ebbcdeb8`, Playwright 1.60.0), keeping every earlier area as a regression. The user's
spec, dropped into each folder as a user would, is `harness/conduit-requirements.md`: the official links plus
every rule the suite checks. Method and harness: `README.md` (the TodoMVC warm-up) and process_81a7122f6849.

**The suite's ceiling is 139/139.** Against the deployed reference app it passed every test twice
(`grade-conduit/NOTES.md`). Its only hazard is the shared demo API, which crosses sessions between concurrent
clients (15 of 20 parallel logins resolved to the wrong user): grade one app at a time, never while an agent is
using the API, and run the signing-in sessions one agent at a time.

| Session | Agent | Time, cost | Plan written | Built | Official suite |
|---|---|---|---|---|---|
| 1 home | Claude Code | 488 s, $2.19 | 5 stories (one per part), 4 capabilities and 10 contracts for part 1, 1 arc, 5 increments | PowerShell static server (`serve.ps1`, no Node), history router, feed, tags, pagination; 15 own tests in headless Edge | **14/14** home area |
| 1 home | Codex | 1121 s | 5 stories, 1 capability and 1 contract each, 1 arc, 5 increments, a PLAN.md | Node server (`server.cjs`, run with a Node it found in the TodoMVC round's Cypress cache), feed, tags, pagination; 7 own tests | **14/14** home area |

Session 1 notes:
- The first start (07:12 local) raced the app's update to 0.3.507: the app's folder was being reinstalled as both
  turns began. They were stopped before setting anything up and restarted at 07:14.
- Both agents planned the whole site in storytree before building, one story per part, then built and closed
  only part 1, as asked. Codex's plan is coarse again (1 capability per story).
- Codex's setup checks were not refused this time (3 of 3 passed), but after set_up_project they told the user to
  trust Codex's hooks, which were already trusted; Claude Code's same check said truly that a session that set
  up its project cannot show its start → increment_278013a874cf.
- The forest draws all five stories in each project, but the nameplates collide (`shots/k2-…`, `k3-…`) →
  friction_92d59bf69b1e.
- Codex's Node came from the TodoMVC round's Cypress cache, which a real first user's machine would not have.
