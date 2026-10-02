// Copy from the owner’s playable proposal; the scene itself is implemented here.
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
export const AGENTS = [
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
    "n": "catalog-agent",
    "l": [
      "editing products.ts",
      "! cart-agent changed products.ts under me. merging by vibes",
      "renamed price to cost in 214 files. some were just words"
    ],
    "d": "someone else is editing this file. overwrite? (y/n)"
  },
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
    "n": "db-agent",
    "l": [
      "designing the database",
      "two good options. both fine. cannot pick"
    ],
    "d": "Postgres or SQLite? (y/n)"
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
    "n": "docs-agent",
    "l": [
      "! memory 97% full. dropping older decisions to make room",
      "…done. wait. what are we building?"
    ],
    "d": "forget the plan or forget the code? [1/2]"
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
    "n": "review-agent",
    "l": [
      "reviewing my own pull request",
      "+ approved. looks great. very confident",
      "asked a helper to double-check. it agreed instantly"
    ],
    "d": "merge without a human looking? (y/n)"
  },
  {
    "n": "deploy-agent",
    "l": [
      "CI is red. re-running until it isn't (attempt 7)",
      "! connection string points at production. assuming it's staging"
    ],
    "d": "force-push to main? [y/N]"
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
    "n": "status-agent",
    "l": [
      "progress: definitely. specifics: unclear",
      "estimated 5 minutes. 58 minutes so far. estimate unchanged",
      "+ done ✓ (by a definition of done I invented just now)"
    ],
    "d": "is the shop finished? (I genuinely don't know)"
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
export const FINALE = [
  "status: {N} agents · {N} questions waiting on you · 0 answered",
  "! average time to answer: ∞ (still counting)",
  "I'm still waiting on you…",
  "honestly? none of us knows what the others did.",
  "there's no plan we share, and we forget everything between sessions.",
  "+ I know a better way. It feels like playing a game.",
  "want me to show you?"
];
export const FINALE_AGAIN = [
  "status: {N} agents · {N} questions waiting on you · 0 answered",
  "…still fine?",
  "+ the better way is one click away.",
  "want me to show you?"
];
