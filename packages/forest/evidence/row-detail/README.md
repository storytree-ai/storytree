# Expandable session rows: worktrees and window files (contract 7.8)

The real desktop page (built by `../sessions-list/build.mjs`), with synthetic activity and a stubbed
window reading; run both through `flock /tmp/storytree-heavy.lock`.

- `collapsed.png`: every row has one expander; the row with a subagent shows it as "+1".
- `expanded.png`: the first row expanded: its three worktrees' full paths, then the five files in its
  window in the order first opened (the one compacted out of the window is muted), then its subagent.
