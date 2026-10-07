# The capability tree in its own pannable space — increment_9ca333f00405 (ADR-0743)

The owner, 2026-09-28, on The command line's panel: *"The capability tree deserves a dedicated
space, the user should be able to pan around it if the tree is too large. Also it seems like we
not showing the state of each capability, as we did in 0.2 we should bring this over. In this
image the tree is way too small to see."*

What changed, ported from 0.2's studio sub-map (`layoutSubdag`, `usePannable`, the status-strip
cards):

- **Its own space.** The panel gains "Open the capability tree" (the preview under it opens it
  too). The tree opens in a layer over the forest, beside the panel, which narrows to its
  drill-down while the tree is open. × or Escape closes it; closing the story closes it.
- **Pan and zoom, never shrink.** Drag moves it; the wheel, a trackpad pinch or a two-finger pinch
  zooms about the pointer. No scroll bars, and the pan is bounded so the tree stays in reach. It
  opens at full size centred on the story's own cards, and keeps its place while the live reading
  redraws.
- **State on every card.** A strip across the top names the work state in words, coloured as the
  arc surface colours it: planned grey, in progress amber, landed green. Below the title, the
  marks "the agent reports: …" and, where something wrote it, "storytree saw: …" (ADR-0630).
- **Graph layout.** dagre, bottom to top, as 0.2: what a capability builds on sits below it, and
  another story's capability sits beside the one that builds on it, instead of one row of all 17.
  Other stories' cards are smaller, muted, dashed, name their story, and are not buttons
  (ADR-0659 D3).

## Captures for the owner

Unedited CDP screenshots of the real **`pnpm desktop:smoke` Electron window** (1120 × 860, the
smoke's own size), against the snapshot `2026-09-28T13-42-19-911Z.json` restored into a throwaway
home: 1,728 records, 10 stories, 70 capabilities. Each run also passes the smoke's own forest
census and exits 0 ([logs](smoke-panel-tree-panned.txt), [state](electron-capture.json)).

- [panel.png](panel.png) — The command line's panel: its sentences, **Open the capability tree**
  and the preview, and the capability shown below (1 · Front door).
- [tree.png](tree.png) — the tree in its own space at readable size (cards 208 × 94 on screen),
  after clicking 3 · Library in it: the panel below now explains 3 · Library.
- [panned.png](panned.png) — the same after a drag and one wheel step out (scale 0.74).
- [mixed.png](mixed.png) — the same view with mixed work states: **landed**, **in progress** and
  **planned** strips side by side. ⚠ These states are SYNTHETIC. The snapshot carries the library
  but not the agent activity log the work states are read from, so on a restored home every
  capability reads "planned" (as in the first three pictures). [seed-activity.mjs](seed-activity.mjs)
  wrote claims (released at once) for seven of The command line's capabilities and landed reports
  for four, into a copy of the throwaway home only.

What I make of them: the cards are readable at the resting view, the states now read in words, and
the owner's worst case is navigable. Two things he may not like: The command line's tree is wide
(about 3,100 px at full size, because ten of its eleven capabilities build on others' and each of
those cards has a place), so at the smoke's 1120 px window only a part shows at once; and the
links into 1 · Front door, which ten capabilities build on, run long. The look is his to accept.

## How to run

Run from the checkout root. Keep the wrapper on the same `STORYTREE_HOME` as
`pnpm gate`; apply the throwaway home only to the child command using `env` after
`--`. Exporting the throwaway home for the wrapper would select a different lock.
Only participating commands serialize; uncontrolled competing work still affects timings.

```sh
CAPTURE_STORYTREE_HOME=$(mktemp -d)
STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" node --import tsx scripts/restore-library.mjs ~/storytree-lanes/snapshots/2026-09-28T13-42-19-911Z.json --project storytree
DISPLAY=:137 STORYTREE_EMBEDDER=off node packages/dev-loop/src/heavy-lock.mjs -- env STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" \
  node --import tsx packages/forest/evidence/captree/electron-capture.mjs          # panel, tree, panned
STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" node --import tsx packages/forest/evidence/captree/seed-activity.mjs <snapshot.json>   # a COPY of the home
DISPLAY=:137 STORYTREE_EMBEDDER=off CAPTREE_SHOTS=mixed node packages/dev-loop/src/heavy-lock.mjs -- env STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" \
  node --import tsx packages/forest/evidence/captree/electron-capture.mjs
```

On Mint this used the gear lane's extracted Xvfb (`/tmp/gear-xvfb/root`) on a private display,
and linked the installed Linux Postgres package into desktop's ignored `node_modules`, since
desktop declares Windows binaries only.

## Proof

- [red.txt](red.txt): 4.9 (no layout yet) and 4.10 (no status strip) fail; 4.6–4.8 still pass.
- [green.txt](green.txt): the same tests pass.
- [Library patch and supervisor checklist](library-update/README.md).

The shared capture kit resolves Playwright from this checkout. Pictures and measurements
go to the machine’s temporary `storytree-captures/` folder by default; add `--retake`
to replace the committed evidence in this directory.
