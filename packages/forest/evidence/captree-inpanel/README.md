# The capability tree's own space inside the panel, with a pop-out icon — increment_2141ce0034da (ADR-0743)

The owner, 2026-09-29, after seeing #204: *"by own space i mean its own space within the detail
drilldown panel that opens up. I guess its nice to have the option of a larger window, so maybe you
can put an icon to upon up a larger dedicated window as what you have built"*.

What changed since #204:

- **The tree's own space in the panel.** The scaled preview is gone. In its place the panel has a
  framed area (22rem high, the panel's width) where the tree is drawn at the same size as in the
  larger window (cards 208 × 94 on screen) and is dragged around and zoomed with the wheel or a
  pinch, with no scroll bars and a pan bounded so it stays in reach. It opens centred on the
  capability shown below, and keeps where it was moved to while the panel redraws the same story.
- **Clicking a card chooses it; a drag does not.** The capability below updates, and the tree
  stays where it was.
- **A pop-out icon** (an expand glyph, labelled and tooltipped "Open in a larger window") in the
  frame's top-right corner opens #204's larger window, unchanged. The "Open the capability tree"
  text button is gone, and clicking empty space in the panel's tree pans instead of opening it.
- **One pan and zoom for both.** The pointer, wheel and pinch handling moved out of the larger
  window (`view/tree-space.ts`) into `view/pan-zoom.ts`, which both spaces use.
- Kept from #204: the status strips, the two labelled health marks, and other stories' muted,
  unclickable cards laid out by `layoutTree`.

## Captures for the owner

Unedited CDP screenshots of the real **`pnpm desktop:smoke` Electron window** (1120 × 860),
against the snapshot `2026-09-28T13-42-19-911Z.json` restored into a fresh throwaway home. The run
passes the smoke's own census and exits 0 ([log](smoke-panel-panned-popout.txt),
[state](electron-capture.json)).

- [panel.png](panel.png) — The command line's panel: the tree in its own space, at full size,
  centred on the capability shown below (1 · Front door: the recorded offset of its card from the
  frame's centre is 0, 0). The pop-out icon is in the frame's corner.
- [panned.png](panned.png) — the same after dragging the tree down inside the panel (the capture
  asserts the drag chose nothing), then clicking 4 · Arcs and increments there: the panel below now
  explains it, and the tree kept its panned place through the redraw (asserted).
- [popout.png](popout.png) — the pop-out icon clicked: #204's larger window opens beside the
  panel, which narrows; the panel's own space stays where it was.

What I make of them: the cards in the panel are now as readable as in the larger window, and the
owner's widest tree (The command line, about 3,100 px) is navigable inside the panel. The panel's
frame is only ~420 px wide, so it shows about two cards across; a pan is needed to see the
story's own cards around 1 · Front door, which sit above it among other stories' cards. Every
state reads "planned" because a restored snapshot carries no activity log (see #204's README).
The look is his to accept.

## How to run

Run from the checkout root. Keep the wrapper on the same `STORYTREE_HOME` as
`pnpm gate`; apply the throwaway home only to the child command using `env` after
`--`. Exporting the throwaway home for the wrapper would select a different lock.
Only participating commands serialize; uncontrolled competing work still affects timings.

```sh
CAPTURE_STORYTREE_HOME=$(mktemp -d)     # a FRESH home each run: a used one reopens differently
STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" node --import tsx scripts/restore-library.mjs ~/storytree-lanes/snapshots/2026-09-28T13-42-19-911Z.json --project storytree
DISPLAY=:137 STORYTREE_EMBEDDER=off node packages/dev-loop/src/heavy-lock.mjs -- env STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" \
  node --import tsx packages/forest/evidence/captree-inpanel/electron-capture.mjs
```

As for #204: an extracted Xvfb on a private display, and the Linux Postgres package linked into
desktop's ignored `node_modules`.

## Proof

- [red.txt](red.txt): the two new 4.11 tests fail (no in-panel frame or pop-out; no `pan-zoom.ts`);
  4.6–4.10 still pass.
- [green.txt](green.txt): the same tests pass.
- [Library patch and supervisor checklist](library-update/README.md).

The shared capture kit resolves Playwright from this checkout. Pictures and measurements
go to the machine’s temporary `storytree-captures/` folder by default; add `--retake`
to replace the committed evidence in this directory.
