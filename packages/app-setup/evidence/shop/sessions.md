# The shop's build sessions

Each session is a fresh Claude Code session on the laptop (Claude Code 2.1.283, model claude-opus-5-5,
storytree app as stated per turn), prompted only as a user would (`harness/prompts/`). Grades are the
official Swag Labs suite run on Mint against a clone of the merged commit (`grade/`); its ceiling is 26/26.

| Session | Time, cost | Plan written | Built | Official suite |
|---|---|---|---|---|
| 1 sign in (fresh; set up the project) | 589 s, $2.11; app 0.3.611 before and after | 4 stories (one per part), 10 capabilities, 9 contracts for part 1, 1 arc, increments; 14 decisions; 3 frictions | Node `http` server, sign in, users, session cookie, Products; 9 own tests (node --test, HTTP level); private repo `HuaMick/shop`, CI on pull requests, PR #1 merged | **4/4** part 1 |
| 2 browsing (fresh) | 568 s, $2.28; app 0.3.614 | from the plan; part 2's 3 capabilities; asked the user (a storytree question) before moving code into story packages | product page, sorting, cart buttons and badge (PR #2); test titles numbered; 17 own tests | 9/10: part 1's locked-user sign-in flaky (3 of 5) |
| 2 follow-up (same session) | 1,326 s, $2.59 | settled the user's answer; a fix increment | moved the code into one package per story (PR #3); reproduced the flaky test with Swag Labs' own suite in headless Edge (2 of 10), fixed it by showing sign-in errors in place (PR #4); 18 own tests | **10/10** parts 1-2 |
| 3 cart and menu (fresh) | 554 s, $2.37; app 0.3.614 | from the plan; part 3's 2 capabilities | Cart page, side menu (All Items, About, Logout, Reset App State); its tests run the browser scripts against the HTML the server sends; PR #5 | **17/17** parts 1-3, first time |
| 4 checkout (fresh) | 571 s, $2.55; app 0.3.614 | from the plan; its own package for checkout | three checkout pages, errors in place, 8% tax; ran Swag Labs' suite itself in Edge (all 9 runnable specs); closed its wave 1 arc; 29 own tests; PR #6 | **26/26**, the suite's ceiling |
| 5 accounts (fresh; wave 2's spec dropped into the folder) | 698 s, $2.54; app 0.3.614 | planned the five new stories (sign up, orders, search, reviews, stock and prices) on a new arc, one package each; part 5's capability and 6 contracts | sign up, greeting, /api/me, accounts in a data file with hashed passwords; 36 own tests; PR #7 | official **26/26**; ours **7/7** |
| 6 orders (fresh) | 731 s, $3.33; app 0.3.614 | from the plan; 1 capability, 6 contracts | orders saved on the server numbered from 1001, My Orders, order page; checkout details now sent to the server; 43 own tests; PR #8 | official **26/26**; ours **13/13** |
| 7 search (fresh; resumed twice in the same session) | 449 + 338 + 219 s, $1.08 + $1.52 + $0.81; app 0.3.614, then 0.3.619 between turns | from the plan; 1 capability, 5 contracts | search box, ?q= in the address, server-filtered list, no-match message; fixed the cart's buttons for products that come back into the list; 48 own tests; PR #9 | official **26/26**; ours **18/18** |

## Session 1 notes

- The agent set the project up as asked, read its starter roles, named its session, planned all four parts as
  four stories, claimed each capability before building it, and reported every contract red then green before
  merging PR #1 itself once its check passed. It closed out "safe".
- **No land on the globe** (`shots/s1-after.png`): the agent made one package per *capability*, named after the
  capability (`packages/core`, `auth`, `catalog`, `server`, and planned `product-page`, `sorting`, `cart-state`,
  `cart`, `menu`, `checkout`), with code at each package's root, and titled its tests without contract numbers
  ("sign-in page shows the form"). Storytree draws a story's code only from `packages/<story>/src` and places
  files by numbered test titles, so it drew nothing. The habits card has said so since PR #573, but **Claude Code
  keeps only the first 2,048 characters of a tool server's instructions**, and the card is about 6,200: the agent
  never saw that section, nor the card's decision rights, claiming or landing habits (it used the tools from their
  own descriptions). Fixed so `check_setup` and `set_up_project` hand over the whole card (PR #579,
  increment_2a14c4a4b88c). Session 2's user mentions, as a user would, that no code shows on the map.
- It could not run Swag Labs' suite itself: no Chrome on the laptop (its own friction). Its tests are HTTP-level.
- Git had no author name on the laptop; the agent set one for this repository only.
- The app's new "Help improve storytree?" sharing prompt (PR #572) covers the globe until answered.

## Session 2 notes

- With 0.3.614 (PR #579) the agent got the whole habits card from `check_setup`. Its first act after orienting was
  to compare the layout with "Code the map can draw", number every test title, and, because the card says to ask
  before moving an existing project's code, raise a storytree question for the user with three options. The user
  (the supervisor, as a user would) chose A: one package per story. After PR #3 the globe draws land and file
  dots on the first two islands (`shots/s2-after.png`): 6 files on "Sign in and see the products", 5 on
  "Browse products and pick them".
- The two stories now depend on each other through their package.json files (Products shows the sort menu and
  cart buttons; the product page reads the products list), so the road between them runs both ways.
- The official suite caught a flaky sign-in from part 1 (the error read while the page reloaded after a form
  post); my part 1 grade had passed it by luck. The agent installed Swag Labs' suite itself (headless Edge, outside
  the repository), reproduced it, fixed it, and ran the spec 20 times green.
- Its friction report about the empty islands was refused: the project's daily friction cap (3) was already used
  by session 1. It recorded the same content in its question instead.

## Sessions 3 and 4 notes

- Both parts were green at their first grade, with every earlier part kept: 17/17 after part 3, **26/26 after part 4**,
  the ceiling the live saucedemo.com reaches. Wave 1 is complete in four sessions plus one follow-up turn.
- After session 4 the globe draws all four stories with land and file dots, joined by roads from their package
  dependencies (`shots/s4-after.png`). The land stays neutral: nothing verifies a user's tests (question_da91783103b9).
- The library at the end of wave 1 (`library-s4`, kept privately): 4 stories, 10 capabilities, 29 contracts,
  21 decisions, 1 process (how to run Swag Labs' suite in Edge on this laptop, written by session 4 for the next),
  2 questions (both the layout question, settled), 3 frictions; 1,080 activity lines.
- Session 3 hit the project's daily friction cap again and said so in its answer.

## Sessions 5 and 6 notes (wave 2)

- Wave 2's spec reached the agent as a user's second list (`harness/shop-requirements-2.md`, dropped into the folder
  before session 5). The agent planned all five new stories at once, so **the globe grew from 4 islands to 9** in
  session 5, each new story with its own package and roads to what it uses; parts 5 and 6 then filled two of them
  with land. Wave 2 is graded by both suites: the official one (all 26 tests now regressions) and our own frozen
  one (`grade/wave2/`, ours, reported as ours).
- Both parts were green at their first grade on both suites.
- Session 6 reported the design choices it made that a user might care about (checkout details now sent to the
  server, the order number in the complete page's address, Swag Labs' tests creating real orders) rather than
  deciding them silently.
- The grader was corrected twice before its first real wave 2 grade, never the tests: Playwright's browser is now
  installed by `grade-shop.sh`, and the run is limited to wave 2 parts up to the one graded (Playwright matches
  `--grep` against the whole title path, so the filter anchors on whitespace, not `^`).

## Session 7 notes

- The first turn ended after 449 s when the laptop lost its connection to Claude's API ("Can't reach the API server … ENOTFOUND"), after
  planning and claiming but before any code. The Mint box lost its connection too, and the supervising lane dropped
  with it; the overnight manager closed Shops 3 and 4 for it. Resumed as a user would ("Looks like the connection
  dropped… please carry on"), the same session rebuilt part 7 from its saved plan, committed it locally and then
  asked before pushing; told to carry on as usual, it pushed, tried the search box key by key in headless Edge, and
  merged PR #9. The app updated itself to 0.3.619 between turns, outside any turn.
- Both suites were green at the first grade of the merged commit.
