# The director's rubric (increment_fa48e88589f9)

The first short, "seeing what agents built", is a pixel-art split screen. On the left a developer works WITHOUT storytree; on
the right the same developer at the same desk works WITH it. Both ask Claude Code to build a wishlist for an online shop.
Judge the cut against this list, not against taste. Items 1 to 5 are the bar the last loop used (increment_ea834305fe2d);
items 6 to 10 are the owner's notes of 2026-10-19 on that loop's cut.

1. **Set and staging.**
   - A believable desk at the perspective of the owner's reference picture (`../reference/`).
   - The monitor is at a normal size for the developer.
   - A keyboard and mouse sit on the desk. His hands are on the keyboard when he types. The chair faces the desk.
   - Both halves use the same room.
   - The props and the room are pixel art in the developer's style, simpler than the reference.
2. **The product is current.**
   - The map is storytree's current glass sheet: a lit perspective slab resting at a tabletop tilt, with thick land and
     islands in rows by depth. It is not a globe. (`../../freeplay-shop-panels/freeplay-shop-story-1440.png` is the app's own screenshot of this shop's sheet, with a story's panel and its capability graph open.)
   - The island's side panel and the capability graph show the story's real parts.
3. **Legibility.**
   - No sprite or prop covers text that is the beat's focus.
   - Every line a viewer must read is held at least its reading time: about 2.5 words a second, plus 1 second (`timing.md`
     lists each and how long it is held).
   - No text is clipped by its box, except code that deliberately runs off the screen.
4. **Pacing.**
   - 45 to 60 seconds in total, with one idea per beat.
   - Each punchline is held: the short prompt, Claude's answer, the empty chair, the left-hand developer still going back to
     the code.
   - The two halves' contrasting beats line up in time, and the halves cut together.
5. **Craft.**
   - No popping, jitter or misregistered frames. Cuts land on beats.
   - Pixels scale by whole numbers (here ×4) in one palette.
   - Full-screen cut-ins are used whenever the screen is the point.
6. **The shop's map, not storytree's own.** The right half's map is the shop built with storytree (its stories: Signing in,
   Browsing, Cart, Checkout, Accounts, Orders, Admin, Reviews). Nothing from storytree's own map shows (for example "the dev
   loop", "the website", "the forest").
7. **The feature asked for is a new story node.** The wishlist both halves asked for shows on the shop's map as a new island,
   visibly new in the app's own way (not a decoration invented for the short). He clicks it and inspects its capability graph
   (its parts and their states). He thinks "looks about right, let me just check one thing", then asks Claude one short
   question that names a part he just saw in the graph. He then asks for the next feature and leaves while Claude works. The
   left half's long paragraph describes the same part with no names to point at.
8. **No frustration on the left.** No frustrated beat at all: no head in hands, no scratching his head in confusion, no
   "what does this even mean?!"-style bubble. He simply keeps working, going from file to file, working out what was built.
   Contrast comes from time and effort, not emotion. At the end Claude asks him questions and he goes back to the code.
9. **More room.** The frame is drawn at 480×270 and scaled ×4 (every 4×4 block of a lossless still is one colour). The room,
   screens and panels use the space; the map's screen is big enough for the sheet's slab, land and rows to resolve.
10. **The walk-out.** Standing up, he does not pass through his chair: the chair rolls back as he rises, and he walks out on a
    believable line.

## What to return

- Numbered findings, each with a timestamp (or range), the half (left, right or both), a severity (blocker, major or minor)
  and the rubric item(s) it fails. Add a suggested fix where one is obvious.
- A scorecard: PASS or FAIL on each of the ten items, with a line of why.
- A list of what you could not judge from sampled stills.

You see sampled frames only (every 0.25 s and either side of every cut), never the motion between them.
