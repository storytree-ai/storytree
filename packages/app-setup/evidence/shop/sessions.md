# The shop's build sessions

Each session is a fresh Claude Code session on the laptop (Claude Code 2.1.283, model claude-opus-5-5,
storytree app as stated per turn), prompted only as a user would (`harness/prompts/`). Grades are the
official Swag Labs suite run on Mint against a clone of the merged commit (`grade/`); its ceiling is 26/26.

| Session | Time, cost | Plan written | Built | Official suite |
|---|---|---|---|---|
| 1 sign in (fresh; set up the project) | 589 s, $2.11; app 0.3.611 before and after | 4 stories (one per part), 10 capabilities, 9 contracts for part 1, 1 arc, increments; 14 decisions; 3 frictions | Node `http` server, sign in, users, session cookie, Products; 9 own tests (node --test, HTTP level); private repo `HuaMick/shop`, CI on pull requests, PR #1 merged | **4/4** part 1 |
| 2 browsing (fresh) | 568 s, $2.28; app 0.3.614 | from the plan; part 2's 3 capabilities; asked the user (a storytree question) before moving code into story packages | product page, sorting, cart buttons and badge (PR #2); test titles numbered; 17 own tests | 9/10: part 1's locked-user sign-in flaky (3 of 5) |
| 2 follow-up (same session) | 1,326 s, $2.59 | settled the user's answer; a fix increment | moved the code into one package per story (PR #3); reproduced the flaky test with Swag Labs' own suite in headless Edge (2 of 10), fixed it by showing sign-in errors in place (PR #4); 18 own tests | **10/10** parts 1-2 |

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
