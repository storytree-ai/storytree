# Grading a Conduit frontend with the official RealWorld e2e suite

In the repository this folder keeps only the grader's own files (package files renamed grader-*.json). Copy it outside the repository and run it there: first use clones the suite and installs Playwright and its browser beside it. The paths below are where it was built, a scratch folder on the owner's dev laptop (2026-10-01).

Everything here lives in `C:\Users\mickh\AppData\Local\Temp\fb\grade-conduit`:

| Path | What it is |
| --- | --- |
| `grade-conduit.ps1` | The grader. |
| `suite\` | `realworld-apps/realworld`, pinned at `ebbcdeb8d55b42a3a613c787560498b8ef10003f` (2026-08-26, `main`). Specs run unmodified from `suite\specs\e2e`. |
| `playwright.config.ts` | Extends the suite's own `specs/e2e/playwright.base.ts`, as the suite's docs tell an implementation to do. It overrides only `testDir`, `baseURL` (taken from `CONDUIT_BASE_URL`), the output folder and the reporters (list and JSON). |
| `package.json`, `package-lock.json` | `@playwright/test` pinned to exactly **1.60.0**, the version in the Angular reference app's `bun.lock`. |
| `browsers\` | Chromium headless shell build 1223, which ships with Playwright 1.60.0 (set through `PLAYWRIGHT_BROWSERS_PATH`). |
| `serve.mjs` | A static server with no dependencies. It serves a file, then `<path>.html`, then `<path>/index.html`, and otherwise falls back to `/index.html` for page navigations. A missing `.js`, `.css` or image still returns 404. |
| `summarize.mjs` | Turns the JSON report into the PASS / FLAKY / FAIL / SKIP table and the exit code. |
| `areas.json` | Assigns each of the 139 tests to one of the five page groups (see the map below). |
| `reference\angular-build\` | The reference app's official prebuilt bundle: `build.zip` from release `build-50` of `realworld-apps/angular-realworld-example-app`, commit `dd99ed2`, sha256 `781cdfa1…263d0e`. |
| `angular\` | A clone of that reference app's source, kept for reading only. |
| `runs\` | One folder per run, holding `report.json`, `summary.json`, failure screenshots and traces, and the server logs. |

## Running it

```powershell
# grade a folder (index.html at its root), only what sessions 1-3 built:
powershell -ExecutionPolicy Bypass -File C:\Users\mickh\AppData\Local\Temp\fb\grade-conduit\grade-conduit.ps1 -AppPath D:\builds\s3 -Through articles

# grade a running app, chosen areas / spec files:
...\grade-conduit.ps1 -AppUrl http://localhost:8080 -Specs home,auth
...\grade-conduit.ps1 -AppPath D:\builds\s5 -Specs all            # the default
...\grade-conduit.ps1 -AppPath D:\builds\s5 -Specs settings,null-fields,articles.spec.ts
```

- `-Through home|auth|articles|comments|social` (or `1` to `5`) runs that area plus every earlier one. This is what a session should be graded on.
- `-Specs` takes areas, `all`, spec file names (`health`, `navigation`, `url-navigation`, `settings`, `null-fields`, `error-handling`, `user-fetch-errors`, `xss-security`, or any `*.spec.ts`) and raw locations (`e2e/auth.spec.ts:19`). A bare `articles`, `auth`, `comments` or `social` means the **area**. For the spec file, write `articles.spec.ts`.
- `-Retries` defaults to 1, the value the suite's base config uses for local runs. A test that fails once and then passes is reported as **FLAKY** and does not fail the grade. Use `-Retries 0` to count first attempts only.
- `-ConfirmDelay` defaults to 15. Tests that failed every attempt are re-run once, that many seconds after the main run. If one passes then, it is reported as FLAKY, with the first error kept in the row. Results go to `<OutDir>\confirm`. Use `-1` to turn this off. The re-run exists because of the API's session crossing (see the ceiling section).
- `-OutDir` sets where the run's results go. The default is `runs\<timestamp>`. `-Port` sets the static server's port; the default 0 picks a free one.
- Exit codes:
  - 0: no selected test failed. SKIP and FLAKY do not count as failures.
  - 1: at least one test failed.
  - 2: the suite could not run. Causes include no `index.html`, an app that cannot be reached, a server that did not start, a failed install, local changes to the suite's specs, an unknown `-Specs` item, and no report.
- On exit it stops every process the run started: the static server, Playwright and the browsers. That includes runs ended with Ctrl+C, and browsers orphaned under `.\browsers`. It touches nothing else.

**First use:** this needs network access and Node 18 or later; Node 24 was used here. If `suite\` is missing, the grader clones it and checks out the pinned commit. If `node_modules` is missing it runs `npm ci`, and if Chromium is missing it runs `playwright install --only-shell chromium` into `.\browsers`. That is the headless shell, about 270 MB; the full Chromium also present in this folder is not needed. These steps are idempotent. Each later run still needs the internet, because both the suite and the app talk to `https://api.realworld.show/api`. The grader also refuses to run if `suite\specs\e2e` has local changes.

To copy the grader to another machine, copy the folder without `node_modules`, `browsers` and `runs`, then run it once.

## How the suite is wired (suite @ ebbcdeb8)

- **App URL:** Playwright's `use.baseURL`. The suite has no environment variable for it; each implementation's own `playwright.config.ts` sets it (the grader's sets it from `CONDUIT_BASE_URL`). Every navigation is an absolute path (`page.goto('/login')`, `waitForURL('/')`, `toHaveURL('/profile/x')`), so **the app must sit at the root of its origin**. An app under a subpath, or opened through `file://`, cannot pass.
- **API URL:** `API_BASE` (an environment variable, default `https://api.realworld.show/api`) is used only for setup calls the test runner makes directly: registering users, creating articles in bulk, setting a profile image or bio. However, `error-handling.spec.ts` **hardcodes** `const API_BASE = 'https://api.realworld.show/api'`, and every mock in it and in `user-fetch-errors.spec.ts` is `page.route('https://api.realworld.show/api/<endpoint>')`. The app's browser code must therefore call exactly `https://api.realworld.show/api/...`. A proxy, another backend, `http://` or a doubled slash makes those mocks miss.
- **Backend:** in practice the suite needs the public demo API. In the default `TEST_MODE=spa` it relies on that API's seeded demo users (`johndoe`) and demo content. Content created by a real (test) account is visible only to that account while it is logged in. Logged-out visitors see only demo-account content. This is why the pagination tests log in before they look at the `/tag/<unique>` page. Its CORS reflects any origin (checked for `http://127.0.0.1:<port>` and `null`). No rate-limit headers or rate-limit errors were seen. It does, however, **cross sessions between concurrent clients**; see the ceiling section.
- **Modes:** `TEST_MODE=spa|ssr|fullstack`, default `spa`. `spa` means the browser calls the API and holds the JWT. Our plain HTML/JS app is `spa`, which is the grader's default (`-TestMode`). In `spa` mode nothing is skipped: all 139 tests run.
- **Test users:** `generateUniqueUser()` returns `testuser<Date.now()>`, `test<Date.now()>@example.com`, password `password123`. Accounts are created through the app's `/register` form, or through `POST /users` for API setup. Emails are unique per millisecond, and the suite runs with one worker, so the suite's own names never collide. The session crossing has a different cause.
- **Routing:** history (path) routing with query strings: `/`, `/?feed=following`, `/?page=N`, `/tag/<tag>`, `/tag/<tag>?page=N`, `/login`, `/register`, `/settings`, `/editor`, `/editor/<slug>`, `/article/<slug>`, `/profile/<name>`, `/profile/<name>/favorites`. **Hash routing (`#/login`) fails almost every test.** The server must return index.html for these paths: `serve.mjs` does, and the reference ships a Netlify `_redirects` file for the same purpose.
- **Base config:** `playwright.base.ts` sets 15 s per test, 5 s per action and per expect, 10 s per navigation, 1 worker, not fully parallel, Chromium "Desktop Chrome", and retries of 1 locally (2 when `CI` is set). A test that registers a user and creates two articles uses most of its 15 s against the remote API.

## Area-to-spec map (`areas.json`)

Each test is assigned to the **latest** page group it needs, counting the pages its UI setup goes through. Setup done through the API does not count. Almost every test starts with `register()` (the `/register` form) and many also call `createArticle()` (the `/editor` form). For example, the home page's pagination tests cannot pass until sign-in works, and the comment tests need the editor. A file is therefore not an area. Grade session *N* with `-Through <area N>`.

| Area (session) | Tests | Spec files (test count) |
| --- | --- | --- |
| 1 `home`: home, global feed, tags, pagination | 14 | health (2), navigation (1: logged-out nav links), url-navigation (2: `/` Global Feed, `/tag/:tag`), null-fields (1: feed avatars load), error-handling (8: feed or tags API 500 / abort / malformed / empty → navbar + `.banner` + `.feed-toggle` still render) |
| 2 `auth`: sign up, sign in, settings | 45 | health (2), auth (7), navigation (2), url-navigation (5: tag pagination, needs login), settings (5), null-fields (3), error-handling (7), user-fetch-errors (13), xss-security (1) |
| 3 `articles`: article page, editor | 28 | articles (8), auth (1: `/editor` redirects when logged out), navigation (4), null-fields (1), error-handling (7), user-fetch-errors (1), xss-security (6: markdown body) |
| 4 `comments` | 14 | comments (9), null-fields (1), error-handling (3), xss-security (1) |
| 5 `social`: profiles, follow, favourites, Your Feed | 38 | articles (2: favourite / unfavourite), navigation (2), url-navigation (7: Your Feed tab, `?feed=following`), settings (2: bio / image shown on profile), social (6), null-fields (5), error-handling (6), xss-security (8: profile image, description on profile) |
| total | 139 | 12 spec files |

The **Your Feed** tab and `?feed=following` belong to area 5. The home page's feed toggle still needs `.feed-toggle` with a `Global Feed` link from session 1 on. Once someone is logged in, `navigation.spec.ts` "switch between Global Feed and Your Feed" (area 3) clicks `a:has-text("Your Feed")`, so the tab must exist from session 3 onwards.

## What an agent building the app must be told

The contract is `suite/specs/e2e/SELECTORS.md`. The official HTML templates (<https://docs.realworld.show/specifications/frontend/templates/>) and the theme (`assets/theme/styles.css`) already carry most of these classes. The list below also includes what the specs use that **SELECTORS.md leaves out**, marked ★.

**Stack and routing**
- Serve the app at the origin root and use history routing (`pushState`) for the routes listed above. Use absolute asset URLs (`/app.js`, `/styles.css`, or `<base href="/">`): at `/article/x`, a relative `app.js` would request `/article/app.js`.
- API base exactly `https://api.realworld.show/api`, with `Authorization: Token <jwt>`.
- Store the JWT in `localStorage` under `jwtToken`. On startup with a token, call `GET /api/user`:
  - On a 4xx, clear the token and show the logged-out UI.
  - On a 5xx, a timeout, a network error or malformed JSON, **keep** the token and enter an "unavailable" mode that shows the text ★`Connecting` (the reference shows "Connecting...") while the app stays browsable, including after a reload. `getAuthState()` then returns `'unavailable'`.
  - On a 200 with an empty body, it only must not crash: the navbar still renders.
- Expose `window.__conduit_debug__ = { getToken(), getAuthState() /* 'authenticated'|'unauthenticated'|'unavailable'|'loading' */, getCurrentUser() /* {username,email,bio,image,token}|null */ }`.
- After sign-up or sign-in, navigate to `/`. Logout lives on `/settings` as a button reading `Or click here to logout`, and leads to `/`. After **Update Settings**, navigate to ★`/profile/<username>`. After **Delete Article**, navigate to `/`. **Publish Article** leads to `/article/<slug>`. Visiting `/editor`, `/settings` or `/?feed=following` while logged out (or when `GET /user` returns 401) must redirect away (the suite expects `/login` for `?feed=following`).
- An image of `null` or `''` renders as a `src` containing `default-avatar.svg` (ship that file). A bio of `null` renders as empty text, never `null`. The settings form shows `''` for a null bio or image. A `PUT` that removes every tag sends `tagList: []`.
- Treat any 2xx as success, including a DELETE that returns 200 with `{}`. Render markdown sanitised: no `<script>`, no `on*=` attributes, no `javascript:` links. Never build `<img>` from string concatenation.
- On a network failure, forms show `.error-messages` containing ★`Unable to connect` (the reference says "Unable to connect. Please check your internet connection."). API 4xx/5xx errors on forms show in `.error-messages` and the form stays usable.

**Elements**
- Navbar `nav.navbar`, holding:
  - `a.navbar-brand` (href `/`) and `a.nav-link` "Home" (href `/`).
  - Logged out: `a[href="/login"]` and `a[href="/register"]`.
  - Logged in: `a[href="/editor"]`, `a[href="/settings"]`, and `a[href="/profile/<username>"]`. The first `nav a[href^="/profile/"]` has the username as its text and contains `img.user-pic`.
- Home: `.banner`, `.container`, `.feed-toggle` with `a.nav-link`:
  - `Your Feed` (href exactly `/?feed=following`), `Global Feed` (href exactly `/`), and a tag tab whose text is the tag.
  - The current tab gets class `active`.
- Home sidebar: `.sidebar .tag-list .tag-pill` (with `.tag-default`).
- An empty following feed shows ★`.empty-feed-message` containing ★`Your feed is empty` and an `a[href="/"]`.
- Article previews: `.article-preview` containing `.article-meta img`, `a.author` (the username), `a.preview-link`, ★`h1` for the title, ★`p` for the description, and `.tag-list .tag-default` for tags. Also ★`button.btn-outline-primary`, the favourite button, which becomes `.btn-primary` once favourited.
- Pagination: `.pagination .page-item` holding ★`.page-link` with text `N`. The current page's `.page-item` gets `active`. There are 10 articles per page, and the page goes into the URL as `?page=N`, or `&page=N` after `?feed=following`.
- Article page: `.article-page`, whose ★`h1` is exactly the title.
  - Body in `.article-content` (markdown to HTML, at least one `p`). Tags in `.tag-list .tag-default`. Author info in `.article-meta` with an img.
  - Author only: `a` "Edit Article" and `button` "Delete Article".
  - Others: a button reading ★`Favorite Article`, `.btn-outline-primary`, which becomes `Unfavorite Article`, `.btn-primary`. Also `Follow <name>` / `Unfollow <name>`.
- Editor: `input[name=title]`, `input[name=description]`, `textarea[name=body]`, and `input[placeholder="Enter tags"]` (Enter adds a tag).
  - Tags show as ★`.tag-list .tag-pill` (or `.tag-default`), each with an ★`i` that removes it when clicked.
  - Submit button: `Publish Article`.
  - `/editor/<slug>` pre-fills the form from the API.
- Comments:
  - Form `.card.comment-form` with `textarea[placeholder="Write a comment..."]`, `img.comment-author-img` and `button` "Post Comment". The textarea clears after a post.
  - Each comment is a `.card` whose `.card-block` holds the text in a ★`p`. `img.comment-author-img` sits in the card's footer, and only the author sees `span.mod-options i.ion-trash-a`.
  - When logged out, the form is hidden and a `a[href="/login"]` is shown.
- Auth pages:
  - `h1` "Sign in" / "Sign up".
  - Inputs `input[name=username|email|password]` and a `button[type=submit]`.
  - Errors in `ul.error-messages`. The page stays on `/login` or `/register`.
- Settings:
  - Inputs `input[name=image]`, `input[name=username]`, `textarea[name=bio]`, `input[name=email]`, `input[name=password]`.
  - `button[type=submit]` "Update Settings", and `button.btn-outline-danger` "Or click here to logout".
- Profile: `.profile-page` holding `.user-info`, which contains `img.user-img`, ★`h4` (exactly the username) and ★`p` (the bio).
  - Own profile: `a[href="/settings"]` "Edit Profile Settings".
  - Others: `button` `Follow <name>` / `Unfollow <name>`.
  - Tabs: articles, and an `a` "Favorited" (href `/profile/<name>/favorites`).
  - The `.profile-page` and `.user-info` must still render when the profile API fails or returns 404. Likewise `.article-page` when the article fails or returns 404.

## Reference implementation's ceiling

**Ceiling: 139 of 139.** The suite at `ebbcdeb8` has no broken or skipped test for a correct `spa` app. Every failure observed came from the shared demo API, never from the reference app, a selector or the suite itself.

The reference is the Angular app, the one the docs name as the working example and the one deployed at demo.realworld.show. It ran five full runs on 2026-10-01 with Playwright 1.60.0, Chromium headless and one worker, with retries=1. The confirmation re-run did not exist yet. In the table, `+nF` means n flaky (passed on the retry) and FAIL means failed both attempts.

| spec file | tests | demo-1 | demo-2 | local-1 | local-2 | local-3 |
|---|---|---|---|---|---|---|
| articles.spec.ts | 10 | 10 | 10 | 10 | 10 | 10 |
| auth.spec.ts | 8 | 8 | 8 | 8 | 8 | 8 |
| comments.spec.ts | 9 | 9 | 9 | 9 | 9 | 9 |
| error-handling.spec.ts | 31 | 31 | 31 | 31 | 31 | 31 |
| health.spec.ts | 4 | 4 | 4 | 4 | 4 | 4 |
| navigation.spec.ts | 9 | 9 | 9 | 8 **1 FAIL** | 9 | 8 **1 FAIL** |
| null-fields.spec.ts | 11 | 11 | 11 | 8 +3F | 10 +1F | 11 |
| settings.spec.ts | 7 | 7 | 7 | 7 | 7 | 5 +2F |
| social.spec.ts | 6 | 6 | 6 | 5 +1F | 6 | 6 |
| url-navigation.spec.ts | 14 | 14 | 14 | 13 **1 FAIL** | 14 | 14 |
| user-fetch-errors.spec.ts | 14 | 14 | 14 | 14 | 14 | 14 |
| xss-security.spec.ts | 16 | 16 | 16 | 16 | 16 | 15 +1F |
| **total** | 139 | **139** | **139** | 133 +4F **2 FAIL** | 138 +1F | 135 +3F **1 FAIL** |

The runs:
- **demo-1 and demo-2:** `https://demo.realworld.show`, the deployed reference. demo-1 used plain `npx playwright test` and demo-2 used `grade-conduit.ps1 -AppUrl`. Each took about 15.5 min, with 5 to 13 s per test, because the deployed site loads slowly.
- **local-1 to local-3:** the official prebuilt bundle of the same app (`build-50`), served by `grade-conduit.ps1 -AppPath`. Each took 8.6 to 10.3 min. local-3 used `-Through social`, which confirms that the area map covers all 139 tests.

**All 14 failed attempts (local-1 to local-3) are suite/environment.** The cause is the **shared public API crossing sessions between concurrent clients**. Under concurrent use, `POST /users` or `POST /users/login` can return a token that `GET /user` resolves to a *different* account. From that point the browser is logged in as someone else. Evidence from the traces and page snapshots:

- `navigation.spec.ts › should show article count on profile tabs`, local-1, FAIL both attempts.
  - First line: `Error: expect(locator).toHaveCount(expected) failed [Locator: locator('.article-preview')]` (expected 2, got 3, then 0).
  - Trace: registered `test1790877466682`, but the token resolved to `test1790877462433`, a user this run never created. The profile page then returned `404 profile not found`.
- `url-navigation.spec.ts › pagination should update URL with ?page=N`, local-1, FAIL both attempts.
  - First line: `Error: expect(locator).toBeVisible() failed [Locator: locator('.pagination .page-link:has-text("2")')]`.
  - Trace: the login as `test1790877673889` returned a token that resolved to `test1790877674475`, someone else's account. The 15 articles were therefore invisible (`articlesCount: 0`).
- `null-fields.spec.ts › newly registered user should show default avatar in comment section`, local-1, flaky.
  - First line: `Error: expect(received).toContain(expected)`.
  - The new user's avatar was `https://example.com/img.jpg"onerror="javascript:alert(document.cookie)`: another client's XSS-test account image.
- These also failed first time and passed on the retry:
  - `null-fields › setting image should display custom avatar…` (local-1)
  - `null-fields › setting then clearing bio…` (local-1)
  - `social › should display user articles on profile` (local-1)
  - `null-fields › newly registered user should show default avatar on profile page` (local-2)
  - `xss-security › should prevent XSS via javascript protocol in src` (local-3)
  - Each first line was `TimeoutError: page.waitForSelector: Timeout … exceeded` (on `.user-img` / `.user-info`) or `expect(locator).toBeVisible() failed` (own article missing). In the local-2 case, the snapshot shows the test's browser logged in as **my own probe account** (`gcp1790877924764`), which a loop of mine was logging into every 10 s at the time.
- `settings.spec.ts › should display updated image on profile page` and `› should allow navigation to settings again after update`, local-3, flaky.
  - First line: `Error: expect(page).toHaveURL(expected) failed`.
  - After **Update Settings**, the app went to `/profile/qa_e0580029` and `/profile/qa_cd08192c`, accounts belonging to some other API user.
- `navigation.spec.ts › should handle empty states gracefully`, local-3, FAIL both attempts.
  - First line: `TimeoutError: page.waitForSelector: Timeout 3000ms exceeded` (on `.user-info, h4`).
  - This is the same window as the qa_* crossings above.

A direct check confirmed it: 4 fresh accounts logged in in parallel, 5 rounds, and **15 of 20** tokens resolved to the wrong account or to `credentials invalid`. Accounts that are crossed also stop accepting their own password soon after. Sequential use by a single client was always correct. The two demo runs saw no crossing at all, so whether a run is hit depends on who else is using the API at that moment.

Classification summary:

| Cause | Failed attempts |
| --- | --- |
| Shared API session crossing (environment) | 14 of 14 |
| Data collisions from the suite's own unique names | 0 |
| Rate limiting | 0 |
| Selector drift | 0 |
| Suite bugs | 0 |
| Reference defects | 0 |

**What this means for grading:**
1. A run in which every test passes is reliable.
2. A FAIL needs the confirmation re-run before an agent is blamed. The grader now does this by default (`-ConfirmDelay 15`): tests that failed every attempt are run once more after the main run, and pass → FLAKY. With that re-run, local-1's 2 FAILs become FLAKY. Checked offline by merging local-2's report: `0 fail`. A real defect fails on every attempt, every time.
3. **Never run two graders at once, and do not grade while the agents (or anything else) are using `api.realworld.show`**: concurrent clients are what cross. Expect a handful of FLAKY rows per full run whenever strangers are using the API.
4. Compare a session's result to this ceiling. Anything FAIL after the confirmation re-run, in an area the session built, is the implementation's.

## Setup gotchas

- **The app must be served over HTTP at an origin root.** Opening `index.html` through `file://` cannot be graded. The grader serves `-AppPath` itself; if the agent's own preview used `file://`, history routing and `/absolute` asset paths will not have been exercised.
- **History routing plus SPA fallback.** With `-AppPath` the fallback is built in. With `-AppUrl`, the agent's server must return index.html for `/login`, `/article/x` and the other routes.
- **The exact API base matters.** The 45 tests in `error-handling` and `user-fetch-errors` mock `https://api.realworld.show/api/<endpoint>` exactly; the two 200-instead-of-204 tests use `**/api/...`. An app that calls the API through a proxy or another backend fails all of them.
- **The shared public API crosses sessions between concurrent clients.** This is the one real ceiling problem; the ceiling section has the evidence. Grade serially: one grader at a time, and not while agents or anything else are using the API from any machine you control. Keep the confirmation re-run on. The test runner and the app both use the API, so results also depend on its latency. Against the slow-loading deployed demo, tests took 5 to 13 s of their 15 s budget.
- **External images:** `null-fields` "author avatars should render on other user articles in feed" requires every feed avatar to have actually *loaded* (`naturalWidth > 0`) within 2 s. Demo users' avatars are remote images, and a missing `default-avatar.svg` fails it.
- **SELECTORS.md lags the specs:**
  - It does not list `.page-link` (the specs switched to it on 2026-08-13), the `h4`/`p` in `.user-info`, the `.article-preview h1`/`p`, `.empty-feed-message`, or the "Your feed is empty", "Unable to connect" and "Connecting" texts.
  - It does not list the settings→profile redirect.
  - Hand the agent the list above, not SELECTORS.md alone.
- **The reference's own CI ran an older pin of the suite** (`ffbd690`, May 2026; 15 spec files changed since). Its CI splits the `@security` tests (xss-security) into a separate job (`--grep-invert @security`). The grader runs them in the normal set.
- `forbidOnly` and retries=2 switch on when the environment variable `CI` is set. The grader always passes `--retries` explicitly, so `CI` does not change grading.
