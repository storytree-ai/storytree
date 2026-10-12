# The harness step shows Pi's mark (increment_dcf865db5b9a)

ADR-1007 D5 (owner, 2026-10-11): a harness's mark appears on the "works with your existing coding harness" step only when
storytree watches it and its setup check can verify it. Pi became watched in PR 1261 (increment_a70433071926): storytree ships
a Pi extension that forwards Pi's events, and the setup check installs it and says whether Pi is verified (setup check 8.29).
So Pi joins the row, after Claude Code and Codex, as one more entry in `harnesses` (`src/tour-copy.ts`).

| Step | Marks before | Marks after |
|---|---|---|
| Works with your harness. | Claude Code, Codex | Claude Code, Codex, Pi |

**Pictures.** `before/` is `main` at d1c8324a, `after/` this branch, at 1440×900 and 390×844 on SwiftShader, three seconds
into the harness step's line while it plays. `seen.json` records the card, the row, each mark's box and the line under them.
Made with `node packages/website/evidence/harness-pi/capture.mjs [--before]` after `pnpm --filter @storytree/website build`.

**How the row reads now.** On a phone (390) the three marks fit one row (Pi ends at x 366 of a 374 card edge). On a laptop
(1440) the card is 400px wide, so Pi wraps onto a second row under Claude Code, its mark the same 44px as the others; the
row was already `flex-wrap`, so nothing shrinks and no style changed.

**Where the mark came from** (Pi's own published mark, used unaltered, beside its name, as a plain "works with" reference; it
implies no endorsement):
- `public/harness/pi.svg` (800×800 viewBox, three coloured shapes on a transparent ground): the file pi.dev offers under its
  logo's "Download" menu for dark backgrounds, `https://pi.dev/logo-on-dark.svg` (downloaded as `pi-logo-on-dark.svg`; the
  same file as `/logo-on-light.svg` and `/logo-auto.svg`), fetched 2026-10-12, sha256
  `abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b`. pi.dev is Pi's home, linked from
  github.com/earendil-works/pi (package `@earendil-works/pi-coding-agent`).
