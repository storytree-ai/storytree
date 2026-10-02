# Capability cards say proposed, healthy, unhealthy or untested; the tree opens fitted — increment_66e436b80cfa (ADR-0744)

What changed:

- **The card's word.** Each capability card's strip now says **proposed** (amber), **healthy**
  (green), **unhealthy** (red) or **untested** (grey), 0.2's words in 0.2's studio colours; another
  story's card says its word too. The capability shown below the tree says its word beside its
  title. "planned / in progress / landed" and "not landed yet" have left the card (they stay on the
  arc surface). The two labelled marks, "the agent reports" and "storytree saw", are unchanged. A
  card is tinted by its word (healthy edged green, unhealthy red), no longer by the agent's report.
- **Proposed is a flag.** Every capability is proposed until the agent says it is built
  (`storytree capability built <capability>`, or the agent link's `mark_built`; `capability
  proposed` / `built: false` switch it back). Switching it off makes nothing healthy: from then on
  the word comes only from storytree's verified column — every contract verified passing is
  healthy, any verified failing is unhealthy, anything else is untested. A capability written
  before the flag reads proposed.
- **The tree opens fitted.** The panel's space and the larger window both open with the whole tree
  fitted in the frame and centred, never above full size and never below the least zoom (0.3). The
  larger window's "Centre" is now "Fit" and puts that view back. The view is kept across live
  redraws as before. The legend shows the four words.

## Pictures for the owner

Unedited CDP screenshots of the real **`pnpm desktop:smoke` Electron window** (1120 × 860), each
run on the snapshot `2026-09-28T21-35-29-644Z.json` restored into a FRESH throwaway home. Each run
passes the smoke's own census and exits 0 ([panel/window log](smoke-panel-window.txt),
[words log](smoke-words-words-close.txt), [state](electron-capture.json)).

- [panel.png](panel.png) — The command line's panel opening fitted. Its tree is 3,057 × 500 px, so
  the fit wants 0.14; it stops at the least zoom, 0.3, where the tree is 917 px wide in a 423 px
  frame. Every card says PROPOSED: nothing has been switched off in the snapshot.
- [window.png](window.png) — the larger window, opened from the panel's icon, also at 0.3 (the
  fit wants 0.24 in its 730 px frame), with the four-word legend and "Fit".
- [words.png](words.png) — **SYNTHETIC** flags and verified health (./seed-words.mjs, written into a
  throwaway copy only): 1 · Front door switched off with its contracts verified passing (healthy),
  2 · Who wrote it with one verified failing (unhealthy), 3 · Library with one contract not verified
  (untested); every other card stays proposed. The larger window, fitted.
- [words-close.png](words-close.png) — the same, wheel-zoomed to 0.55 over those three: all four
  words legible. Note 4 · Arcs and increments: PROPOSED although "storytree saw: passing" — the
  flag, not the health, decides until the agent switches it off. The capture then pressed "Fit"
  and asserted the view returned to the opening one.

What I make of them: the words read clearly once zoomed, and the colours match 0.2's. At the
opening zoom the card text is too small to read on The command line — its tree does not fit whole
at 0.3 in either frame. Lowering the least zoom to about 0.13 would let it fit whole (with card
text unreadable until zoomed); that is a one-line change and the owner's call. The look is his to
accept.

## How to run

```sh
export STORYTREE_HOME=$(mktemp -d)     # a FRESH home each run
node --import tsx scripts/restore-library.mjs ~/storytree-lanes/snapshots/2026-09-28T21-35-29-644Z.json --project storytree
DISPLAY=:137 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/cardwords/electron-capture.mjs
# the four words: a fresh home, restored, then seeded
node --import tsx packages/forest/evidence/cardwords/seed-words.mjs
DISPLAY=:137 STORYTREE_EMBEDDER=off CARDWORDS_SHOTS=words flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/cardwords/electron-capture.mjs
```

As for #204/#210: the gear lane's extracted Xvfb (`/tmp/gear-xvfb/root`) on a private display, and
the Linux Postgres package linked into desktop's ignored `node_modules` for the run (removed after).

## Proof

- [red.txt](red.txt): the new tests fail before the build.
- [green.txt](green.txt): `pnpm test`, full scope, every unit passing (see its note on 8.5 and this
  box's stale launcher).
- [Library patch, switch-off list and supervisor checklist](library-update/README.md).

The shared capture kit resolves Playwright from this checkout. Pictures and measurements
go to the machine’s temporary `storytree-captures/` folder by default; add `--retake`
to replace the committed evidence in this directory.
