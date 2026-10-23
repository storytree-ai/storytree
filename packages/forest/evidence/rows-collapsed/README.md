# Session rows start collapsed (forest 7.8)

Increment `increment_34e43152b01e`, arc `arc_895e232031b0`. The real desktop page (built unmodified by `../bottom-panel/build.mjs`, headless
Chromium through Playwright on Linux) with the bottom-panel capture's synthetic activity; `capture.mjs` drives it at 1440x960 and asserts the measures below.

```sh
node packages/forest/evidence/bottom-panel/build.mjs
PLANET_PLAYWRIGHT=<playwright-core/index.mjs> PLANET_CHROMIUM=<chrome-headless-shell> node --import tsx packages/forest/evidence/rows-collapsed/capture.mjs
```

## Pictures

- [Fresh load: every row collapsed](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/rows-collapsed/collapsed.png)
- [One row opened by its expander](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/rows-collapsed/one-expanded.png)
- [Measures](measures.json)

## Measures

- Fresh load: three rows at work, every expander `aria-expanded="false"`, no detail drawn, the builder's subagent folded under its "+1"; the strip is 157px tall.
- Clicking the builder's expander opens only that row: its Worktrees, Running and Files, then its child; the strip grows to 257px.
- Clicking it again restores the fresh list exactly. No expand-all control.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 2 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/rows-collapsed).
