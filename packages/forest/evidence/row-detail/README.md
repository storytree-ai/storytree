# Expandable session rows: worktrees and window files (contract 7.8)

The real desktop page (built by `../sessions-list/build.mjs`), with synthetic activity and a stubbed
window reading; run both through `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --` (use the absolute checkout path).

- `collapsed.png`: every row has one expander; the row with a subagent shows it as "+1".
- `expanded.png`: the first row expanded: its three worktrees under a "Worktrees" label, each by its folder name (full path on hover), then, under
  "Files", the five files in its
  window in the order first opened (the one compacted out of the window is muted), then its subagent.

**Since rows start collapsed (forest 7.8, 2026-10-11 re-run):** the capture no longer folds the row first; it checks every row starts
collapsed. `--smoke` builds its own page and takes no pictures; forest's numbered 7.8 browser test runs it, so a control the capture
waits for that the strip stops drawing fails on the changing branch.
