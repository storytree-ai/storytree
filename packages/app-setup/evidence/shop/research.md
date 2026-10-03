# Choosing the shop's spec and test suite (Shop 0, increment_a09aac7b3583)

A research pass on 2026-10-04 looked for a shopping-site spec with an official or widely used public
end-to-end suite we did not write, as Conduit had (RealWorld's 139 Playwright tests) and TodoMVC had. Each
claim below was checked by cloning the repository and counting the tests; anything unchecked says so.

**Nothing matches Conduit's size and neutrality.** No shop spec comes with a large, implementation-neutral
official suite. The candidates:

| Candidate | Licence | Suite | Black-box? | Fit |
|---|---|---|---|---|
| **Swag Labs** (saucedemo.com; [saucelabs/sample-app-web](https://github.com/saucelabs/sample-app-web)) | MIT | Official WebdriverIO suite, `test/e2e`: 28 tests in 11 specs; the local config runs **26** (it excludes 2 Sauce Visual specs that need a Sauce account) | Yes, against any app with its pages, classes and two storage keys (`session-username` cookie, `cart-contents` localStorage) | The best-known practice shop. Frontend only and small: sign in, products, product page, cart, menu, checkout |
| Practice Software Testing / Toolshop ([testsmith-io](https://github.com/testsmith-io/practice-software-testing)) | **Custom, all rights reserved**: private, internal, non-commercial use; no publishing copies or derivatives | 1 official Playwright test; ~190 Pest feature tests tied to its Laravel internals; best community suite ~36 tests (GPL-3.0) | Community suite yes | The richest spec (OpenAPI per sprint, five sprint versions, full stack), but its licence forbids publishing derivatives, and this build is published on storytree's public website and repository |
| Automation Exercise (automationexercise.com) | Closed site, terms unverified | 26 UI and 14 API test cases, **in prose only** | Yes | Good feature list, but we would write every test ourselves |
| eShop, Saleor storefront, Next.js Commerce, Medusa starter | MIT/BSD | 0 to ~10 e2e tests | — | Too few tests |
| Spree, Vendure, Evershop, OpenCart, nopCommerce | various | Large but platform-internal | No | Re-implementing means rebuilding the platform |

**The choice: two waves, with the line between what others wrote and what we wrote kept visible.**

1. **Wave 1 is Swag Labs, graded by its official suite, unmodified.** Pinned at
   `saucelabs/sample-app-web@e0948dd0` (2026-09-21), run with its own local config. Its ceiling is **26/26**:
   the suite passed every test against the live reference at https://www.saucedemo.com on 2026-10-04
   (`runs/sauce-reference.txt`). It is MIT, so the suite and the products' data may be used freely, and it is
   the shop that test-automation courses everywhere practise on, so a visitor may recognise it. Its only
   quirks (a `session-username` cookie and a `cart-contents` list in localStorage, which the suite sets
   directly) are stated in the user's spec, as Conduit's were. The one change to the grading environment:
   chromedriver is installed at the grading box's Chrome version (`grade/setup-sauce.sh`).
2. **Wave 2 grows the shop past Swag Labs, graded by an acceptance suite we write ourselves and freeze before
   wave 2 starts.** No public suite covers accounts, order history, search, reviews or stock, so this half is
   judged by criteria we made up, and the evidence says so wherever it reports a wave 2 grade. The suite is
   committed, dated, before the wave's first session, and never edited to fit the build.

**Why not Toolshop, though its spec is the best?** Its licence. The website replays this build's growth and
names its parts, and the build would be a derivative of Toolshop's API and page spec. Asking the owner to
accept a licence risk on the public site is not worth it when an MIT suite exists for the half that can be
graded independently.

**Why Swag Labs is small, and why that is acceptable.** Its suite checks the purchase journey, 26 tests, not a
whole shop. The tour needs a familiar domain, several stories with several parts, real dependencies, and
growth: wave 1 gives four stories built on each other (sign in, browsing, cart, checkout), and wave 2 adds
the next wave of stories and roads. The suite's job is to stop the build from being judged only by its own
agent, and for the half it covers, it does.

**Full stack, so stories have real code and real dependencies.** The user's spec asks for the shop's own
Node server from part 1 (Swag Labs' reference is a frontend with hard-coded users), with data kept in files,
so nothing is shared between grading runs (Conduit's shared demo API crossed sessions between clients).

Raw research notes, with every source: the research pass's digest is summarised above; its clones lived in
`/tmp/shopr/` on the Mint box (not kept).
