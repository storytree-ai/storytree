# Wave 2's acceptance suite: ours, frozen before wave 2

Written by the supervising session from `../../harness/shop-requirements-2.md` alone, on 2026-10-04, before
the shop's wave 2 had a line of code and before its agent had seen that spec. No public suite covers what
wave 2 adds (accounts, orders, search, reviews, stock and an admin), so these criteria are ours, and every
wave 2 grade in the evidence says so.

- 29 Playwright tests, one file per part (5 to 9), titled by part ("6.3 …"); one worker, because the tests share
  one server and its data. `SHOP_URL` points them at the shop (default http://localhost:3100).
- Black-box: only the pages, `data-test` names, wording and `/api/me` the spec states. Each test makes its own
  users, so a run never depends on data a previous run left.
- **Frozen.** It is never edited to fit the build. It has run against no implementation (none exists), so it
  may hold its own mistakes: a test found to contradict the spec is corrected in the open, with the reason, in
  the evidence, and never loosened past what the spec says.

Run: `npm ci && npx playwright install chromium && SHOP_URL=http://localhost:3100 npx playwright test`
(`../grade-shop.sh` does this for parts 5 onward).
