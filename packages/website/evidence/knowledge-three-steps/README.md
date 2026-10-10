# The knowledge chapter in three steps (ADR-0990, proposed; contract 2.20; increment_70272deadf4c)

Reshaped on the map chapter's model (ADR-0984): far before near, one idea per line with the globe showing it as it is said, taught
on the shop's own record (shop3, 5 October 2026). It stays on the globe the map chapter leaves, the first round's four stories at
the 03:08:57 survey, with no swap. Each picture is its step as it settles, played in order at 1920, 1440, 1280, 390 and 320 on
SwiftShader (the Mint box's software WebGL); `-line-N` pictures are taken as that line is said. `1440-knowledge-chapter.webm` is
the whole chapter at the tour's own 0.75×. `framing.json` says, for each picture, whether the islands its step frames stand in
view and clear of the header band, the card, the bar and the panels.

Made with `node packages/website/evidence/arrival/capture.mjs --only knowledgeSteps`, after `pnpm --filter @storytree/website build`.

| # | Step | The globe shows | Pictures |
|---|---|---|---|
| 1 | Decisions live inside the map. | Health's view of the four stories, as the map chapter leaves it, under the owner's line (★); with the third line the land turns plain and the shop's notes show inside the globe, beneath the islands they are about. | `*-knowledge-inside-line-3.png`, `*-knowledge-inside.png` |
| 2 | Every story keeps a shelf. | The camera goes in to checkout. With the second line the card of checkout's decision "Finish becomes a form post; the cart is cleared on the complete page, not on the click" (02:55) opens beside it, above 600px; a phone says it in words. | `*-knowledge-shelf-line-2.png`, `*-knowledge-shelf.png` |
| 3 | The next agent reads it first. | The shop's sessions list as it stood at 03:06, with the orders session (Part 6: Orders) followed: its recorded reading path walks the notes it opened (03:02 to 03:04), and with the third line its claims on checkout (03:05) stand as flags in its colour. The comparison with Cursor's rules and Graphiti is in this step's depth. | `*-knowledge-reads-line-3.png`, `*-knowledge-reads.png` |

★ "Storytree remembers things using a knowledge graph." is the owner's line, kept word for word (ADR-0857 D3); every other line, How and Why is DRAFT, written by the session that built it, marked in `src/tour-copy.ts`.

**Choices made here (the owner can reshape any of them).**
- Five steps became three: the kinds of note and the core where loose notes gather went into step 1's How; the comparison step
  went into step 3's depth, as the map chapter keeps its comparisons; the caveat "A read shows what was opened, not what the
  model understood" went into step 3's How, so the step fits a 320×568 phone.
- The shop, not storytree's own library: measured, the shop's record holds 50 decisions (47 by the survey the chapter stands at),
  5 principles and 178 recorded note reads by 11 sessions; storytree's saved library holds 785 notes and reads as a cloud at the
  tour's scale.
- The chapter holds the globe at 03:08:57 but reads the record at 03:06, when the reads happened; step 3's How gives the times.
- The site's recorded cores had no transcript reader, so a followed session drew no path; they now answer every window read as
  absent from the public recording, and the core draws the session's recorded reading path instead (ADR-0990 D2).
- The flags on step 3 are every claim standing at 03:06 on the four stories, in the holders' colours: the orders session's on
  checkout (three) and the cart (one), with the accounts session's two on signing in and the stock session's one on browsing,
  which the close view on checkout leaves out of frame. The map chapter's first-round flags are unchanged.

**Seen, not fixed (for the owner's shaping).**
- The reading path replays as one head walking the session's reads, looping; a still shows one segment of it. The clip shows it
  move. Most of the orders session's reads are of notes on Orders, an island this chapter does not raise, so much of the path
  runs to notes away from the four stories.
- On step 2 the Finish decision's dot is not marked on the globe; only its card opens. The card carries the title alone: the
  public recording keeps decisions' titles, not their bodies.
- The notes are small dots at the four-story view; they read better close up on checkout.

**Measured only here.** Frame rates and motion smoothness on a hardware GPU (the laptop) were not measured; the box draws with
SwiftShader.
