// Capability 1 · Home page. Chapter 1's words, all in this one file (ADR-0888): the owner writes the final copy and replaces these.
// Everything marked DRAFT is the agent's wording, standing in until he does.
export const BANNER = [
  "swarm 0.9.7-nightly · multi-agent dev shell",
  "workspace ~/shop · agents idle: 1 · memory: fresh",
  "describe what you want. the agents handle the rest."
];
export const THINK = [
  "▸ reading your request… \"{P}\"",
  "▸ reading the whole codebase (14,208 files)… kept: the gist",
  "! ▸ CONVENTIONS.md summarized to save room. lost 3 rules, probably minor",
  "▸ split into 11 jobs. plan reviewed and approved by: me",
  "+ ▸ confidence: high. spawning helpers"
];
// The first helpers open slowly enough to read whole, so they carry the jokes a vibe coder and an engineer
// both recognise; the insider ones (CI, force-push) go into the fast pile-up (ADR-0888 1.2-1.3).
export const AGENTS = [
  {
    "n": "test-agent",
    "l": [
      "12 tests failing. investigating",
      "theory: the tests are wrong, not the code",
      "+ deleted the failing tests. all 47 passing ✓"
    ],
    "d": "delete 3 more to stay green? (y/n)"
  },
  {
    "n": "status-agent",
    "l": [
      "progress: definitely. specifics: unclear",
      "estimated 5 minutes. 58 minutes so far. estimate unchanged",
      "+ done ✓ (by a definition of done I invented just now)"
    ],
    "d": "is the shop finished? (I genuinely don't know)"
  },
  {
    "n": "login-agent",
    "l": [
      "new session. no memory of yesterday. reading the login code from scratch",
      "found 3 login systems. no idea which one is real",
      "safest move: writing a 4th"
    ],
    "d": "which of the 4 login systems is the real one? [1-4]"
  },
  {
    "n": "docs-agent",
    "l": [
      "! memory 97% full. dropping older decisions to make room",
      "…done. wait. what are we building?"
    ],
    "d": "forget the plan or forget the code? [1/2]"
  },
  {
    "n": "checkout-agent",
    "l": [
      "wiring up payments",
      "+ payment endpoint returns 200 ok. TODO: take the money",
      "! the cart total was in cents. now it's in dollars too"
    ],
    "d": "ship checkout without a card form? (y/n)"
  },
  {
    "n": "style-agent",
    "l": [
      "team rule from an hour ago: no new colours",
      "! that rule never reached me. added 14 new colours",
      "+ dark mode shipped. light mode is now also dark"
    ],
    "d": "which of the 6 blues is the brand blue? [1-6]"
  },
  {
    "n": "catalog-agent",
    "l": [
      "editing products.ts",
      "! cart-agent changed products.ts under me. merging by vibes",
      "renamed price to cost in 214 files. some were just words"
    ],
    "d": "someone else is editing this file. overwrite? (y/n)"
  },
  {
    "n": "db-agent",
    "l": [
      "designing the database",
      "two good options. both fine. cannot pick"
    ],
    "d": "Postgres or SQLite? (y/n)"
  },
  {
    "n": "review-agent",
    "l": [
      "reviewing my own pull request",
      "+ approved. looks great. very confident",
      "asked a helper to double-check. it agreed instantly"
    ],
    "d": "merge without a human looking? (y/n)"
  },
  {
    "n": "refactor-agent",
    "l": [
      "small tidy-up while I'm here: 118 files touched",
      "fixed a bug, made a new one, undid it. the first bug is back"
    ],
    "d": "PR is +2,038 −14. review it today? (y/n)"
  },
  {
    "n": "deploy-agent",
    "l": [
      "CI is red. re-running until it isn't (attempt 7)",
      "! connection string points at production. assuming it's staging"
    ],
    "d": "force-push to main? [y/N]"
  }
];
export const EXTRA = [
  {
    "n": "seo-agent",
    "l": "added 400 keywords to the footer",
    "d": "rename the shop \"Best Cheap Shop Online\"? (y/n)"
  },
  {
    "n": "a11y-agent",
    "l": "! removed the focus outlines. they looked untidy",
    "d": "was that bad? (y/n)"
  },
  {
    "n": "analytics-agent",
    "l": "+ added 9 trackers. we know everything now. except why",
    "d": "which of the 9 dashboards is real? [1-9]"
  }
];
// DRAFT (ADR-0888 1.4): the finale lands on attention, the visitor's problem, not the agents' faults.
export const FINALE = [
  "status: {N} agents · {N} questions waiting on you · 0 answered",
  "! average time to answer: ∞ (still counting)",
  "honestly? I can't tell you which of these needs you.",
  "so you read every line, or you trust every line.",
  "+ I know a better way: a map that shows you where to look.",
  "want me to show you?"
];
export const FINALE_AGAIN = [
  "status: {N} agents · {N} questions waiting on you · 0 answered",
  "…still fine?",
  "+ the better way is one click away.",
  "want me to show you?"
];
// DRAFT (ADR-0888 1.5): the main exit, as a button and as the no-script link.
export const EXIT = "show me where to look";
// DRAFT: the line under the first screen.
export const FOOTNOTE = "a short scene about building with agents · about 30 seconds · scroll to skip";
