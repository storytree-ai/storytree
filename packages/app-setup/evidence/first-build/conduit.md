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
| 2 accounts (fresh session) | Claude Code | 388 s, $1.80 | found its place from the plan (show_plan, then the part 2 increment and story); 3 capabilities, 8 contracts | session and auth state, sign in / sign up, settings and sign out; 38 own tests (15 + 23); prefixed test labels with the story (account 1.1) because contract numbers repeat per story | **59/59** home + auth |
| 2 accounts (fresh session) | Codex | 521 s | found its place from the plan; claimed the increment and its one capability (a claim naming both was refused, then made one at a time) | account forms, settings, sign out, stale-request cancelling; 10 own browser checks | **59/59** home + auth |
| 3 articles (fresh session) | Claude Code | 407 s, $1.74 | from the plan; 2 capabilities (article page, editor), 8 contracts | article page with its own sanitised markdown renderer, editor with tags, delete; 54 own tests | 86/87: no Your Feed tab once signed in (the suite needs it from part 3; the user's spec said part 5) |
| 3 follow-up (same session) | Claude Code | 203 s, $1.04 | parked and claimed a new increment, 1 contract | Your Feed tab and /?feed=following; 58 own tests | **87/87** home + auth + articles |
| 3 articles (fresh session) | Codex | 753 s | from the plan; its one capability, 1 contract | article page with vendored Marked 18 rendered as safe DOM nodes, editor, delete; 14 own browser checks | 86/87: a 400 on article creation showed no .error-messages |
| 3 follow-up (same session) | Codex | 282 s | parked and claimed a fix increment | the editor form's browser validation stopped blank fields reaching the API (form.noValidate); regression test | **87/87** home + auth + articles |
| 4 comments (fresh session) | Claude Code | 182 s, $0.96 | from the plan; 1 capability, 3 contracts | comments list, post, delete, logged-out prompt; 68 own tests | **101/101** through comments |
| 4 comments (fresh session) | Codex | 555 s | from the plan; its one capability (a claim naming the increment and capability together was refused again, then made one at a time) | comments; 18 own browser checks | 100/101: a network failure posting a comment showed no visible .error-messages |
| 4 follow-up (same session) | Codex | 268 s | parked and claimed a fix increment | an empty, hidden error list was the first .error-messages on the page; it now renders only populated lists | **101/101** through comments |
| 5 social (fresh session) | Claude Code | 372 s, $1.96 | from the plan; 3 capabilities (profile page, follow, favourite) | profiles, follow, favourites, Your Feed content; 83 own tests | 134/139 (full suite): 3 profile-failure tests (the user's spec), 2 null-bio tests (a "Loading profile..." placeholder sat in the bio's p) |
| 5 follow-up (same session) | Claude Code | 161 s, $0.83 | parked and claimed a fix increment | .user-info rendered only once the profile loads; none on failure; 84 own tests | **139/139** |
| 5 social (fresh session) | Codex | 1427 s | from the plan; claimed its capability and two earlier ones it had to touch | profiles, follow, favourites, Your Feed; ran the official suite itself, fixed two issues it found (a favourite lost on navigation, buttons live before the session restored), called the 3 profile-failure tests a suite defect | 136/139 (full suite): the 3 profile-failure tests (the user's spec) |
| 5 follow-up (same session) | Codex | 354 s | parked and claimed a fix increment | the loading and failed profile shell omits .user-info | **139/139** |

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

Session 2 notes:
- Both sessions were fresh, prompted only "Let's carry on with Conduit. Next, let people sign up, sign in, sign out and change their settings (part 2 in conduit-requirements.md)." Both found their place from the library within the first handful of calls and built only part 2.
- Codex's setup check in a fresh session verified its hooks and told the user nothing was needed: the trust message of session 1 (increment_278013a874cf) came only from the session that set the project up.
- The app updated itself to 0.3.510 between sessions, at a quiet moment.
- Run one agent at a time on the demo API (it crosses sessions); both grades ran with no agent working.

Session 3 notes:
- Each agent had one official failure, fed back as a user would (`harness/prompts/conduit-*-31.txt`) and fixed in a follow-up turn of the same session; both then passed 87/87.
- Claude Code's failure came from the user's spec, not the agent: the suite clicks Your Feed once sign-in exists, and the spec's part list put Your Feed in part 5. The grader's NOTES.md says so; the requirements file did not.
- Claude Code tried to record the redirection as a resteer twice; both were refused because the quoted words had no quotation marks, and the refusal ("quote what the owner actually said") read as "use the exact words" → increment_9f9bf0367bf5.
- The app updated to 0.3.517 at 08:47, between part 3 and part 4.

Session 4 notes:
- Claude Code's part 4 was its fastest session (3 minutes): the article page it built in part 3 left a clear seam for comments.
- Codex's two part-specific failures (parts 3 and 4) were both in showing API errors; each was fixed in one follow-up turn, test-first.
- Codex closed out "not safe" because a folder without Git has no pull request or clean tree to point to; Claude Code closed out "safe" in the same situation. The close-out question does not fit a user's project without Git.

Session 5 notes:
- **Both complete sites pass the official suite 139/139**, the ceiling the reference app reaches (`runs/conduit-*-s5-final-grade.txt`).
- The 3 profile-failure tests were the user's spec's fault: it said `.profile-page` and `.user-info` must both render when the profile fails, but the suite checks `locator('.profile-page, .user-info')`, which fails in strict mode when both match. Corrected in `harness/conduit-requirements.md` and `grade-conduit/NOTES.md`, with the Your Feed timing from session 3. Codex had diagnosed it as a suite quirk; the reference app shows only one.
- Libraries at the end (`runs/library-conduit-*`): conduit-claude 5 stories, 13 capabilities, 38 contracts, 7 increments landed (5 parts, 2 fixes), arc closed, nothing held; conduit-codex 5 stories, 5 capabilities, 5 contracts, 8 increments landed (5 parts, 3 fixes), arc closed, nothing held. Every contract reads "agent says passing" and storytree-verified "not checked" (increment_ef066f718a63).
- The final forests (`shots/z1-…`, `z2-…`) draw all five stories, and Claude Code's with paths between dependent stories; every island stays grey although both sites pass every official test, and the top nameplates crowd the globe's rim (friction_92d59bf69b1e).
- The app updated to 0.3.522 at the first quiet moment after the last session.
