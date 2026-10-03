# CI health, proven on the shop (increment_02947bc9dab4, ADR-0901, ADR-0902)

The shop (arc_04c1b9977f4f, `packages/app-setup/evidence/shop/`) is a user's project on a private GitHub
repository, built by the test laptop's own Claude Code. Its CI runs `node --test` on every pull request and
every push to `main`; nobody set anything up for storytree. `replay.ts` reads each of its 13 push runs on `main`
exactly as `storytree health ci` reads a project's newest one: the job log's TAP, the commit the run tested,
the test titles in the files at that commit, and the shop's plan (its library record after session 9).

| run | commit | tests | unmatched | passing | failing | not checked (of 63) |
|---|---|---|---|---|---|---|
| 37134671651 | 5ccdef3 | 0 | 0 | 0 | 0 | 63 |
| 37134918015 | 3ec115b | 9 | 9 | 0 | 0 | 63 |
| 37139273606 | 41420bd | 17 | 17 | 0 | 0 | 63 |
| 37140036425 | fa18d9d | 17 | 0 | 17 | 0 | 46 |
| 37140971930 | 8aa6d74 | 18 | 0 | 18 | 0 | 45 |
| 37142120669 | 6ad9c9b | 24 | 0 | 24 | 0 | 39 |
| 37142931854 | b7bc821 | 29 | 0 | 29 | 0 | 34 |
| 37144295043 | f84b9bc | 36 | 0 | 36 | 0 | 27 |
| 37145646578 | 733d7b0 | 43 | 0 | 43 | 0 | 20 |
| 37149509188 | 9f3f714 | 48 | 0 | 48 | 0 | 15 |
| 37150020398 | 8084c37 | 53 | 0 | 53 | 0 | 10 |
| 37150241320 | c336510 | 54 | 0 | 54 | 0 | 9 |
| 37151178078 | 7f745ec | 63 | 0 | 63 | 0 | 0 |

Read live through the Actions API (`--live`, the user's `gh` sign-in): run 37151178078 at 7f745ec, 63 tests,
63 contracts verified passing, none unmatched.

What the table shows:
- **Matching by title works where contract numbers repeat.** Each of the shop's nine stories numbers its
  contracts from 1.1; every test is tied to its story by the package whose test file holds its exact title at
  that commit, and from run 37140036425 on none is left unmatched.
- **Honest gaps stay gaps.** The first run has no tests. The next two ran tests before the shop moved its code
  into one package per story (its `story-packages` pull request): those tests are in no story's package, so they
  credit nothing and their contracts stay not checked rather than being guessed at.
- **Not checked shrinks only as contracts get tests on main.** A contract planned later than a run reads not
  checked at that run, so the final plan's 63 fill in landing by landing.
- **Found on the way:** the map's survey keeps a title's source escapes (`admin\'s`), which matched none of the
  runner's six titles with an apostrophe until the reader unescaped them (contract 2.1's test now pins it).

The shop's library lives on the test laptop, so the replay judges without writing; the write itself, and that the
agent's report never colours land, are pinned by contract 3.1's test against a real Postgres.
