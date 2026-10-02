# Would we merge it? A reviewer's read of both Conduit builds (2026-10-02)

A read-only review of both complete builds (139/139 each) as a senior reviewer would read a contractor's pull request, against the benchmarks' known failure mode for agent-written code (monolithic files, structural erosion as features are added, duplication, dead code, verbosity). Paths are relative to each build's folder on the laptop (`C:\Users\mickh\conduit-claude`, `conduit-codex`); the builds themselves are not in this repository.

## Claude Code: merge with light changes

- **Size.** 976 lines of app code (16 JS modules and index.html; `serve.ps1` adds 66); largest file `public/article.js`, 94 lines. Tests 1,538 lines: 80 tests, 228 asserts.
- **Structure.** One DOM helper (`dom.js`), a route table (`app.js`), one request path (`api.js`), shared form and error handling (`forms.js`). Comments, profiles and social arrived as new modules, not by growing old ones. Erosion: an import cycle (five page modules import `navigate` from `app.js`, which imports them), shared helpers living in page modules (`avatarSrc`, `formatDate` in `article-preview.js`), and copied render code (author/date block, tag list, three tab helpers, `message()` twice).
- **Safety.** No `innerHTML` anywhere; text nodes only; a hand-written markdown parser that builds DOM nodes and refuses unsafe URL schemes (no tables or nested lists). A race: a late 401 from the startup token check can sign out a user who signed in meanwhile (`session.js`).
- **Tests.** Real headless Edge against a stubbed API, one iframe per test, tagged by contract, an XSS test, failures exit 1. Nothing covers races or cancellation.
- **Reject-worthy.** None. Minor: the 404 page still says "not built yet"; the comment trash icon is a keyboard-unreachable span with no double-click guard.
- **Top changes.** Break the import cycle; merge the copied helpers; make comment delete a button and guard the startup check.

## Codex: merge after a heavier round

- **Size.** 1,079 lines (about 52 KB, dense: some lines run to 271 characters) in 12 modules plus index.html and app.css; `server.cjs` and `Start.ps1` add 50; vendored Marked (46 KB). Largest file `comments.js`, 130 lines. Tests 681 lines: 21 subtests, 126 asserts.
- **Structure.** Centralised requests; every page cancels its work on navigation. Erosion: long single-closure renderers (`renderComments`, `renderAccount`, one function for sign-in, sign-up and settings switched by flags), the same error-list loop copied five times, per-page lifecycle flags, dates formatted three ways, a shared feed list taking ever more flags, a server that hard-codes every module and repeats the router's routes.
- **Safety.** Strong: Marked with an allowlist turned into DOM nodes, raw HTML dropped, safe URL schemes only; avatar URLs must be http(s); a revision counter guards a sign-in made during the startup check.
- **Tests.** Real headless Edge through a hand-written DevTools client; races, timeouts, 204s and mobile overflow covered. Fragile: one 106-line stub branching on 37 mode strings, subtests sharing browser state, and a failing run that can exit 0.
- **Reject-worthy.** `Start.ps1` runs the Node it finds in the machine's Cypress cache (left by the TodoMVC round), which a user's machine would not have. Also dead code (`notice()`'s unused `part`), unused CSS, a diary-style README that says the full suite was not rerun, and a leftover PLAN.md.
- **Top changes.** Drop the Cypress launcher and make test failures exit non-zero; extract shared error and lifecycle helpers and split the long renderers; delete dead code and the diary docs.

## Comparison

Claude Code's build is the less eroded: smaller, flatter, later features as new modules, isolated readable tests. Its weak points are robustness (no cancellation, the startup race) and some copied render code. Codex's is the more defensive and accessible (cancellation, race guards, ARIA, keyboard support, a real markdown library, edge-case tests) but shows the benchmarks' failure modes more plainly, and ships about 25% more app code for the same features. To inherit one, take Claude Code's and port Codex's cancellation and race handling into it.
