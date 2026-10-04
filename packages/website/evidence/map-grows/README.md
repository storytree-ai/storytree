# The map chapter grows the shop from an empty globe (increment_61ad43b96182, part 2)

Contracts 2.12 and 2.16, both reworded. The owner, reviewing the live site on 2026-10-05 (ADR-0891, amended that day):

> "When the shopping centre globe is introduced, there seems to be a zoom out and zoom in, is this really needed?"
>
> "I'm thinking it starts with an emtpy globe, then the title is "your project shown as a collection of stories". Then the shopping centre can be introduced by growing the storynodes one by one."

Offered two ways to grow it, he chose A ("go with A"): grow it in the order it was recorded.

**What it shows, from the locally built site:** the hand-off from the fixes, then each beat at 1920, 1440, 1280, 390 and 320. Each width has seven frames, `<width>-m0-swelling`, `-m0-empty`, `-m1-planned`, `-m1-named`, `-m2-first`, `-m3-together` and `-m4-parts`, plus a 1440 clip from the fixes to the parts step (`1440-m0-to-m3.webm`). `chapters/` holds every map and agents step at each width. They are made by `node packages/website/evidence/arrival/capture.mjs --only mapGrows` and `--only chapters --to map-grows/chapters`.

**Before:**
- The arrival ended on a "Let's start small" beat that pulled back from storytree's globe, swapped it and dived into the whole shop, with three stories lit (`../arrival/1440-6-start-small.png`, from an earlier lane).
- The map chapter then opened on "Each island is a story" (`../one-format/after/1440-map-stories.png`).

| Beat | Line | The globe |
|---|---|---|
| M0 | "Your project, shown as a collection of stories." (the owner's); "A story is something your software lets someone do." (DRAFT) | Storytree's globe gives way at once to the shop's point, which swells into an empty globe: there is no pull back and no dive. The stage is 05:41, before anything was planned. |
| M1 | DRAFT: "Let's build a shopping site." / "It starts with signing in, then browsing the products, the cart, and checkout." | The four stories planned at 05:48 rise, over about two seconds in the engine's recorded order. Each one lights as the narration names it, and the rest stay dimmed until named. |
| M2 | DRAFT: "Signing in is built first." | Signing in's land fills in (pr1, 05:59, and its fix pr2), with its session's colour on the coast. The others are dimmed. |
| M3 | DRAFT: "Then the other three, all at once, by three agents working side by side." | Browsing, the cart and checkout fill in together (pr3 to pr5, 06:53 to 07:06), each with its session's colour. |
| Then | The owner's lines ("Stories are split into parts.", "Your code is shown as dots in the parts.", "Parts have colours.", "As your project grows, more stories are added."), each followed by a DRAFT story line | The shop as it stood at 07:25, once its first four stories were built and before its second round, with the four stories lit. The last step grows the second round on (Orders and three others). |

The agents chapter now lights the same four stories, with signing in joining products, cart and checkout.

**See:** an empty world, then a shop's plan landing on it, then the work filling it in, in the order it happened.
**Feel:** the build is easy to follow, since nothing has to be taken in all at once, and the cut no longer jolts.
**Think:** "a story is a thing the shop lets you do, and I just watched the four of them get built."

Checks:
- `tour.test.ts`:
  - 2.12: the step after the fixes is the map chapter's, on the shop's point, swelling until its stories are planned.
  - 2.16: M0 to M3 grow what the shop's recorded stages grew, in order (no story; the four planned; signing in built first; the other three together). The teaching steps hold the shop after its first round, the walk is four stories, and Orders grows on in the last step.
  - 2.16 (a new case): each story lights as its name is said (at 2.6 words a second), and a waiting step shows every story it named.
  - All three were red, then green.
- `--verify-camera` 2.12: 250 ms after the map chapter starts, the drawing is already the shop's (at a growth under 1); nothing has risen 3 s in, and four have risen in M1. With the old pull back and dive it was red: `{"map":"own","growth":"whole"}`. Then green.
- `arrival/capture.mjs` asserts the same swap from the fixes, at 1440 and 390.

Residue:
- In M1 the four stories rise over about two seconds, not at the same instant. That is the engine's arrival choreography (world 7.1 to 7.4) stretched over the beat, not something the website sets.
- The memory chapter and the ending are untouched (ADR-0896 and ADR-0897 are still being shaped).
