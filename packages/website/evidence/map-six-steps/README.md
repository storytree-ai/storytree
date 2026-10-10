# The map chapter in six steps (ADR-0984, amending ADR-0891; contract 2.16; increment_2e935aa11ba3)

The owner's order, built on shop3's recording (5 October 2026), played forward in its recorded time. Each picture is its step as
it settles, played in order at 1920, 1440, 1280, 390 and 320 on SwiftShader (the Mint box's software WebGL); `-line-N` pictures
are taken as that line is said. `1440-map-chapter.webm` is the whole chapter at the tour's own 0.75×. `framing.json` says, for each
picture, whether the islands its step frames stand in view and clear of the header band, the card, the bar and the panels.
`*-claims-*.png` are the flags as they drop and lift, from `recorded-claims.mjs`.

Made with `node packages/website/evidence/arrival/capture.mjs --only mapSteps` and
`node --import tsx packages/website/evidence/recorded-claims.mjs`, after `pnpm --filter @storytree/website build`.

| # | Step | The globe shows | Pictures |
|---|---|---|---|
| 1 | The beginning. ★ | The shop's empty globe swells from a point and stays bare. | `*-map-empty.png` |
| 2 | Plans of work are arcs. | The arcs panel over the bare globe: the shop's first arc, its four parts all "to take" (read at 01:53:00, before the first claim at 01:53:08). On a phone the drawer shows its list only. | `*-map-arcs.png` |
| 3 | Stories and pathways. | Each island rises as it is named: signing in, browsing, then the cart and checkout (the order of their first claims, 01:53, 01:58, 02:28). The pathways come on with the second line, those to signing in first, then those to browsing. Nothing is drawn inside an island. | `*-map-stories.png` |
| 4 | Capabilities and your code. | The camera flies into signing in. Its three territories, then browsing's three, arrive in the order they were built; the cart and checkout, with no code yet, carry an equal share per planned capability. The dots come on with the second line, the story panel with the third (above 600px). | `*-map-capabilities-line-2.png`, `*-map-capabilities.png`, `1440-story-panel.png` |
| 5 | Agents claim their work. | The camera pulls back to the four stories. The first round's eight claims (02:28:12 to 02:28:27) drop as flags in their three sessions' colours: browsing's three beside its code, the cart's two and checkout's three in lots. Then the arcs panel (parts 2, 3 and 4 held), then the sessions list (the same three sessions), both read at 02:28:30. The comparison with Cursor, LangSmith and Linear is in this step's depth. | `*-map-claims-line-1.png`, `*-map-claims-line-2.png`, `*-map-claims.png`, `*-claims-*.png` |
| 6 | Health. | Flags lift as capabilities land, the cart's and checkout's code takes their shares' place, and the territories turn yellow then green as CI checks them (to the 03:08:57 survey). | `*-map-health.png` |

★ the owner's words; every other line, and every How and Why, is DRAFT, marked in `src/tour-copy.ts`.

**Choices made here (the owner can reshape any of them).**
- The chapter shows the first round only. The second round's sessions start claiming the cart and checkout again at 03:04, before
  the 03:08:57 survey that turns the round green; those claims are left out, so no flag comes back in the health step.
- Browsing already has code when its three capabilities are claimed, so each claimed capability with no territory of its own gets a
  share sized like its neighbours while it is held (a share of one line would be invisible). It carries a flag but no dashed lot,
  as ADR-0968 marks a lot only on an island with no code.
- The four-story view is a little wider than before (framing 1.32, was 1.25), so Checkout's two-line name ("0 / 3 landed" beneath
  it) stands clear of the header at 1920, 1440 and 1280.
- Step 5's arcs panel is the app's own drawer: on a laptop it covers the top half of the globe while its line is said, flags
  included. The camera does not move for it, so the chapter's only moves are into signing in (step 4) and back out (step 5).
- The arcs panel shows held parts with their session's badge ("Claude Code · 0 min quiet"), not in the session's colour; the line
  says "each held by its own session", which is what it shows.
- Removing the agents chapter took the close-to-close camera clip (`../act2-polish/close-flight`) with it: the map now has only one
  close view. The camera's close-to-close rule is still pinned by its unit test (2.15).

**Framing.** Every framed island's name is clear at every width but one: at 320, on the stories step, the four two-line names crowd
on the small globe and Checkout's hides rather than stray from its island (forest 3.31); the island stands in frame.

**Measured only here.** Frame rates and motion smoothness on a hardware GPU (the laptop) were not measured; the box draws with
SwiftShader.
