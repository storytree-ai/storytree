# Act 2's agents chapter, on the shop's recorded sessions (increment_15c05fe75587, ADR-0893)

The agents chapter teaches on the rebuilt shop's own records, held at two recorded moments on 4 October 2026:
- **06:50 UTC:** parts 2, 3 and 4 claimed by three sessions at once.
- **08:03 UTC:** parts 7 and 8 held, and a third session sent to part 7. It stood down at 08:03:17.

At each moment, the globe, the sessions strip, the arcs and the claim tints are all the shop's as they stood then. The
arcs are rebuilt from the recorded claims and closes (`arcsAt`, `tour-reading.ts`). The tints come from the strip, not from
the growth's stage samples. This replaces the Conduit `sessions-*` and `arcs-*` steps.

| ADR-0893 | Step | Pictures |
|---|---|---|
| G1 the callback | "Agents colliding in a void of code" → "Agents see each other working on the map" | `1440-agents-fix.png`, `390-agents-fix.png` |
| G2 the sessions strip | "Storytree lists your conversations with AI here as active sessions." Three sessions, each island in its session's colour | `1440-agents-sessions.png`, `390-agents-sessions.png` |
| G3 the arcs panel | "It lists plans of work here. In storytree they are known as arcs." The shop's first arc, active: 2 landed, 3 open | `1440-agents-arcs.png`, `390-agents-arcs.png` |
| G4 a claim on both | the arc's claimed increment and the cart island in Part 3's colour, labelled with the session's name in the strip | `1440-agents-claim.png`, `390-agents-claim.png` |
| G5 the payoff | "This means your agents can tell who is working on what just by looking at the map." Three islands, three names | `1440-agents-parallel.png`, `390-agents-parallel.png` |
| G5 the stand-down | the session that read the plan, saw part 7 held and changed nothing, quoted from its own close-out | `1440-agents-standdown.png`, `1440-agents-standdown-depth.png` (with the comparison) |

**Copy:** the owner's lines are his (from ADR-0893). Every other line, title, How and Why is **DRAFT**, marked in
`tour-copy.ts`. The stand-down quote is the session's own close-out, word for word.

**Phone:** the tags' crowding and the arcs drawer running under the card at 390 were fixed by increment_4274bd965ee7
(contract 2.18; before and after pictures in `../agents-phone/`). This folder's pictures are now at 1440, 390 and 320.

Checks:
- `tour-reading.test.ts` 2.17: red, then green. At 06:50, three sessions are live and the first arc is active with two
  increments closed and three claimed; at 08:03, part 7 and part 8 are held and the sent session is live.
- Browser journeys `--verify-tour` (strip names, the shop's arc, the comparison on the last step, no decision numbers),
  `--verify-camera`, `--verify-immersive`, `--verify-forest`, `--verify-recording`, `--verify-opening`,
  `--verify-opening-frames` and `--verify-enlarged`, and `arrival/capture.mjs` (`--only agents` makes these pictures).
