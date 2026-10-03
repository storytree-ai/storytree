# The shop's build sessions

Each session is a fresh Claude Code session on the laptop (Claude Code 2.1.283, model claude-opus-5-5,
storytree app as stated per turn), prompted only as a user would (`harness/prompts/`). Grades are the
official Swag Labs suite run on Mint against a clone of the merged commit (`grade/`); its ceiling is 26/26.

| Session | Time, cost | Plan written | Built | Official suite |
|---|---|---|---|---|
| 1 sign in (fresh; set up the project) | 589 s, $2.11; app 0.3.611 before and after | 4 stories (one per part), 10 capabilities, 9 contracts for part 1, 1 arc, increments; 14 decisions; 3 frictions | Node `http` server, sign in, users, session cookie, Products; 9 own tests (node --test, HTTP level); private repo `HuaMick/shop`, CI on pull requests, PR #1 merged | **4/4** part 1 |

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
