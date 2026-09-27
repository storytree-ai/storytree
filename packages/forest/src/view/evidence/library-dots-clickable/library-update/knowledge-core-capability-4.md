# The knowledge core — capability 4

Apply these **field-level old → new** operations to the existing library records. Record IDs
below come from the read-only 2026-09-27T13-04-06-091Z snapshot. Read current live values
first and preserve later edits, sibling fields, links and shelf entries. Paths in the patch are
logical record targets, not repository files.

## REPLACE: Opening description: mount the summary card

Target: **The knowledge core, capability 4**, `capability_062b84e5c6b0`, field `description`.

Old:

```text
"Look inside" reveals the core at the globe's existing positions, keeping the named shelf entrances while hiding the sea and island surfaces until you return. You can pin an artifact to read it and see its links, replay the selected session, and size artifacts by visits or incoming links without moving them.
```

New:

```text
On the globe in Forest or Library mode, clicking an artifact dot pins it and opens its summary card in the right-hand slot used by the story panel (ADR-0661 D2). The card shows the artifact's kind, title and description or another summary field; when there is no summary it shows the whole text. It has no links list, read counts, depth figures or entrances. Close and Escape dismiss it. Opening a story replaces the card, and opening a card replaces the story panel. The separate Look-inside surface, replay and size controls remain retained but unmounted.
```

## REPLACE: Replace the blanket unmounted/page-entry statement

Target: **The knowledge core, capability 4**, `definition_e51fe26f7832`, field `meaning`.

Old:

```text
**Page entry deferred by ADR-0655 D2.** The following describes the retained implementation
and its contracts. ADR-0658 mounts only capability 1's faint points on the globe.
```

New:

```text
**Globe summary card mounted by ADR-0661 D2.** Forest and Library now use this capability's
existing pin, `noteCard`, shared `Card` type and one card renderer in the right-hand story-panel
slot. The separate Look-inside page entry remains deferred by ADR-0655 D2; its remaining
inspection and replay implementation and contracts below describe retained, unmounted work.
```

## REPLACE: Separate the mounted card from the unmounted inspection view

Target: **The knowledge core, capability 4**, `definition_0984b17957e1`, field `meaning`.

Old:

```text
- **Retained implementation, unmounted:** the pure view is in `packages/knowledge-core/src/look-inside`.
```

New:

```text
- **Summary card mounted; inspection view retained:** the pure view remains in
  `packages/knowledge-core/src/look-inside`. ADR-0661 D2 mounts its summary card on the
  globe; the separate inspection and replay surface remains unmounted.
```

## REPLACE: Shared card model and renderer: no second card implementation

Target: **The knowledge core, capability 4**, `definition_c8d964975134`, field `meaning`.

Old:

```text
  - `noteCard` gives an artifact's card. An artifact is named by its title, its term, or the first
    line of its words, since not every artifact has a title.
```

New:

```text
  - `noteCard` gives one shared `Card`: its summary core carries kind, title, summary and
    whole-text fallback, with retained inspection metadata alongside it. An artifact is
    named by its title, term or first line of words. The shared card renderer displays kind,
    title and the first available nonempty summary field (description, summary, oneLine,
    statement or meaning), or the whole text when no summary is present. It does not render
    links, read counts, depth, entrances or other inspection metadata. Both the globe's
    right-hand slot and the retained inspection panel use this same renderer.
```

## REPLACE: Narrow the stale-link card clause to match the summary

Target: **The knowledge core, capability 4**, `definition_c3773cb3f00a`, field `meaning`.

Old:

```text
  - **Stale links (S1):** no whole-core colouring; a pinned artifact's card says when it links to a
    ghost.
```

New:

```text
  - **Retained inspection data (S1):** `noteCard` still carries evidence when an artifact links
    to a ghost. ADR-0661 D2 narrows the rendered card to its summary; that card shows no
    links list or stale-link report.
```

## REPLACE: As-built desktop mount and mutual replacement

Target: **The knowledge core, capability 4**, `definition_66dfec14a7ad`, field `meaning`.

Old:

```text
  - The renderer makes one core per project it shows and feeds it. The forest's former
    "Look inside" button and mounts were removed by ADR-0655; ADR-0658 now mounts
    `KnowledgeGlobePoints` using that same core. The globe canvas retains its `surface`
    and `inside` props (`packages/forest-world`, the shared engine);
    `surface={false}` hides ADR-0648's see-through shell, which replaced the sea, and every
    island.
```

New:

```text
  - The renderer keeps one core per project and feeds it. The former separate "Look inside"
    button and surface remain unmounted (ADR-0655). `KnowledgeGlobePoints` draws the core,
    and ADR-0661 D2 mounts its shared summary card in the story panel's right-hand slot.
    Forest and Library both use the same pin and card path. Opening a card closes the story
    panel; opening a story clears the pin and replaces the card. Close and Escape clear it.
    The globe canvas retains its `surface` and `inside` props in the shared engine;
    Library's `surface={false}` hides the see-through shell and every island.
```

## REPLACE: Contract 4.1: replace the wide inspection card with the mounted summary

Target: **The knowledge core, capability 4**, `contract_bd9e20c32bc4`, field `title`.

Old:

```text
4.1 · From the globe, the owner can open the core, find a shelf's entrance and pin an artifact; its card shows its text, home, depth or "no depth", replacement evidence where present, and recorded counts.
```

New:

```text
4.1 · Clicking an artifact dot in Forest or Library opens the existing pinned-artifact card in the right-hand story-panel slot. It shows kind, title and description or another summary field; with no summary it shows the whole text. It contains no links list, read counts, depth or entrances.
```

## ADD: ADD contract 4.6, or the next free number

Target: **The knowledge core, capability 4**, `new-contract-4.6`, field `title`.

Old: no corresponding contract in the snapshot. Add it under this capability; use the
next free number if the proposed number was taken later.

New:

```text
4.6 · Opening an artifact card closes an open story panel, and opening a story closes the card. Close and Escape dismiss the card. The shared core pin and summary renderer serve both globe modes without writing to the library.
```
