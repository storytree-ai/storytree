# A launch of the app opens with Stories on and Library off (ADR-1002 D1, 2026-10-12)

**What it shows.** The actual desktop page over the shared eight-story forest seed, at laptop size (1366 × 768), by
the desktop capture kit: `node --import tsx capture.mjs [--retake]`.

- `launch.png`: the app as it opens. Stories is pressed and Library is not: the islands on a solid globe, no note points.
- `library-pressed.png`: one press of Library. The core's notes show through the glass under the same islands, camera and turn.

Each `.json` holds the two switches' `aria-pressed` as read from the page, and the capture asserts them (contract 3.10).
The website's free play is not pictured: it keeps opening with both switches on.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 2 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/launch-switches).
