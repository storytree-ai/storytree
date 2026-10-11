# Idle sessions move from the Live tab to a searchable History (forest 7.10, 7.21, 7.28, ADR-1002 D4)

Increment `increment_750f156451d4`, arc `arc_1fc30b699332`. The real desktop page (built unmodified by `build.mjs`, headless Chromium through
Playwright on Linux) with synthetic activity: two sessions at work, three idle, two that left the list today. `capture.mjs` drives it at
1440x960 and asserts the measures below.

```sh
node packages/forest/evidence/idle-history/build.mjs
CAPTURE_PLAYWRIGHT=<playwright-core/index.mjs> CAPTURE_CHROMIUM=<chrome-headless-shell> node --import tsx packages/forest/evidence/idle-history/capture.mjs --retake
```

## Pictures

- [Live lists only the sessions at work](live-at-work-only.png): no "N idle" row; the header counts 2.
- [History lists the idle sessions first](history-idle-first.png), each led by "idle" and drawn as its live row was (one expanded: its
  worktree and files), then the sessions that left today, led by how they ended.
- [A search typed](history-search-typed.png) ("landed 1181" keeps the one row), and [a search with nothing left](history-search-none.png).
- [Measures](measures.json)

## Measures

- Live draws `ih-builder` and `ih-waiting` only; no `.session-idle-fold`; the count reads 2.
- History's rows, in order: the three idle (`idle` lead each, each with one expander), then `Landed #1181` and `Ended without a close-out`.
- "WISPS idle" keeps the idle wisps session only; "landed 1181" keeps the landed one; "nothing like it" says "No sessions match the search";
  emptied, all five rows return.

## Judged against

History's existing rows: the idle lead sits in the outcome column ended rows use, in its neutral outline, so the two kinds read as one list.
The search box takes the range bar's input style.
