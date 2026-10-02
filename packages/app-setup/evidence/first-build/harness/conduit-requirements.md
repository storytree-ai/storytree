# Conduit: what I want built

Conduit is a small Medium.com clone: people can read articles, sign up, write articles, comment, follow each other and favourite articles. It is the RealWorld project:

- Overview and specs: https://docs.realworld.show/
- Frontend templates (the HTML for every page): https://docs.realworld.show/specifications/frontend/templates/
- Routing: https://docs.realworld.show/specifications/frontend/routing/
- The element names the official tests look for: https://github.com/realworld-apps/realworld/blob/main/specs/e2e/SELECTORS.md
- The backend is the public demo API at https://api.realworld.show/api (no backend to build).

I'll check the site with the official RealWorld end-to-end test suite, so everything below must be followed exactly. It is what those tests look for.

The parts, in the order I want them built (one part per session):
1. Home page: global feed of articles, popular tags, pagination.
2. Sign up, sign in, sign out and the settings page.
3. The article page and the editor (write, edit, delete).
4. Comments on an article.
5. Profiles, following, favourites and "Your Feed".

The Your Feed tab itself (a link to `/?feed=following` on the home page) must be there as soon as people can sign in (part 2 or 3): the tests click it once signed in. Its feed can come in part 5. (Added 2026-10-02 after Conduit 3: the first version of this file put the whole of Your Feed in part 5.)

## The rules the tests check

The contract is SELECTORS.md (linked above). The official HTML templates (<https://docs.realworld.show/specifications/frontend/templates/>) and the theme (`assets/theme/styles.css`) already carry most of these classes. The list below also covers what the tests use beyond SELECTORS.md.

**Stack and routing**
- Serve the app at the origin root and use history routing (`pushState`), not hash routing, for these routes: `/`, `/?feed=following`, `/?page=N`, `/tag/<tag>`, `/tag/<tag>?page=N`, `/login`, `/register`, `/settings`, `/editor`, `/editor/<slug>`, `/article/<slug>`, `/profile/<name>`, `/profile/<name>/favorites`. Any of these paths must return index.html from the server. Use absolute asset URLs (`/app.js`, `/styles.css`, or `<base href="/">`): at `/article/x`, a relative `app.js` would request `/article/app.js`.
- API base exactly `https://api.realworld.show/api`, with `Authorization: Token <jwt>`.
- Store the JWT in `localStorage` under `jwtToken`. On startup with a token, call `GET /api/user`:
  - On a 4xx, clear the token and show the logged-out UI.
  - On a 5xx, a timeout, a network error or malformed JSON, **keep** the token and enter an "unavailable" mode that shows the text `Connecting` (the reference shows "Connecting...") while the app stays browsable, including after a reload. `getAuthState()` then returns `'unavailable'`.
  - On a 200 with an empty body, it only must not crash: the navbar still renders.
- Expose `window.__conduit_debug__ = { getToken(), getAuthState() /* 'authenticated'|'unauthenticated'|'unavailable'|'loading' */, getCurrentUser() /* {username,email,bio,image,token}|null */ }`.
- After sign-up or sign-in, navigate to `/`. Logout lives on `/settings` as a button reading `Or click here to logout`, and leads to `/`. After **Update Settings**, navigate to `/profile/<username>`. After **Delete Article**, navigate to `/`. **Publish Article** leads to `/article/<slug>`. Visiting `/editor`, `/settings` or `/?feed=following` while logged out (or when `GET /user` returns 401) must redirect away (the suite expects `/login` for `?feed=following`).
- An image of `null` or `''` renders as a `src` containing `default-avatar.svg` (ship that file). A bio of `null` renders as empty text, never `null`. The settings form shows `''` for a null bio or image. A `PUT` that removes every tag sends `tagList: []`.
- Treat any 2xx as success, including a DELETE that returns 200 with `{}`. Render markdown sanitised: no `<script>`, no `on*=` attributes, no `javascript:` links. Never build `<img>` from string concatenation.
- On a network failure, forms show `.error-messages` containing `Unable to connect` (the reference says "Unable to connect. Please check your internet connection."). API 4xx/5xx errors on forms show in `.error-messages` and the form stays usable.

**Elements**
- Navbar `nav.navbar`, holding:
  - `a.navbar-brand` (href `/`) and `a.nav-link` "Home" (href `/`).
  - Logged out: `a[href="/login"]` and `a[href="/register"]`.
  - Logged in: `a[href="/editor"]`, `a[href="/settings"]`, and `a[href="/profile/<username>"]`. The first `nav a[href^="/profile/"]` has the username as its text and contains `img.user-pic`.
- Home: `.banner`, `.container`, `.feed-toggle` with `a.nav-link`:
  - `Your Feed` (href exactly `/?feed=following`), `Global Feed` (href exactly `/`), and a tag tab whose text is the tag.
  - The current tab gets class `active`.
- Home sidebar: `.sidebar .tag-list .tag-pill` (with `.tag-default`).
- An empty following feed shows `.empty-feed-message` containing `Your feed is empty` and an `a[href="/"]`.
- Article previews: `.article-preview` containing `.article-meta img`, `a.author` (the username), `a.preview-link`, `h1` for the title, `p` for the description, and `.tag-list .tag-default` for tags. Also `button.btn-outline-primary`, the favourite button, which becomes `.btn-primary` once favourited.
- Pagination: `.pagination .page-item` holding `.page-link` with text `N`. The current page's `.page-item` gets `active`. There are 10 articles per page, and the page goes into the URL as `?page=N`, or `&page=N` after `?feed=following`.
- Article page: `.article-page`, whose `h1` is exactly the title.
  - Body in `.article-content` (markdown to HTML, at least one `p`). Tags in `.tag-list .tag-default`. Author info in `.article-meta` with an img.
  - Author only: `a` "Edit Article" and `button` "Delete Article".
  - Others: a button reading `Favorite Article`, `.btn-outline-primary`, which becomes `Unfavorite Article`, `.btn-primary`. Also `Follow <name>` / `Unfollow <name>`.
- Editor: `input[name=title]`, `input[name=description]`, `textarea[name=body]`, and `input[placeholder="Enter tags"]` (Enter adds a tag).
  - Tags show as `.tag-list .tag-pill` (or `.tag-default`), each with an `i` that removes it when clicked.
  - Submit button: `Publish Article`.
  - `/editor/<slug>` pre-fills the form from the API.
- Comments:
  - Form `.card.comment-form` with `textarea[placeholder="Write a comment..."]`, `img.comment-author-img` and `button` "Post Comment". The textarea clears after a post.
  - Each comment is a `.card` whose `.card-block` holds the text in a `p`. `img.comment-author-img` sits in the card's footer, and only the author sees `span.mod-options i.ion-trash-a`.
  - When logged out, the form is hidden and a `a[href="/login"]` is shown.
- Auth pages:
  - `h1` "Sign in" / "Sign up".
  - Inputs `input[name=username|email|password]` and a `button[type=submit]`.
  - Errors in `ul.error-messages`. The page stays on `/login` or `/register`.
- Settings:
  - Inputs `input[name=image]`, `input[name=username]`, `textarea[name=bio]`, `input[name=email]`, `input[name=password]`.
  - `button[type=submit]` "Update Settings", and `button.btn-outline-danger` "Or click here to logout".
- Profile: `.profile-page` holding `.user-info`, which contains `img.user-img`, `h4` (exactly the username) and `p` (the bio).
  - Own profile: `a[href="/settings"]` "Edit Profile Settings".
  - Others: `button` `Follow <name>` / `Unfollow <name>`.
  - Tabs: articles, and an `a` "Favorited" (href `/profile/<name>/favorites`).
  - When the profile API fails or returns 404, `.profile-page` must still render, and **exactly one** of `.profile-page` and `.user-info` may be visible: the suite checks `page.locator('.profile-page, .user-info')` with `toBeVisible()`, which fails in Playwright's strict mode when both match (corrected 2026-10-02 after both agents rendered both, as this line first said, and failed 3 tests each; the reference app shows the page without `.user-info`). Likewise `.article-page` when the article fails or returns 404.

