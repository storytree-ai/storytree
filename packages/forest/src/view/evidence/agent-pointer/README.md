# A session points the owner's eye at one capability (5.8; question_97c6d6036e47, answered E)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with the capability tree arc in the
stand-in bridge (its open increment names Running sessions and Story node render, both on The forest) and three working
sessions in the agent log:

- **A** claims Story node render (its flag) and points at Running sessions, which the arc names.
- **B** points at Arcs and increments (The command line), for a question.
- **C** points at Agent capability claims, which the arc does not name, for no question.

What this step draws (contract 5.8):

- A pointed capability carries a steady ring in its session's colour at its foot (7 CSS px across its radius) and a second
  ring that opens from it to about 35 px and fades, once every 2.4 s, again and again: slow, so it draws the eye without
  flashing. Both keep their size on screen at any zoom, as a flag does, and hide with their island once it turns away.
  Under reduced motion the second ring holds still, half open.
- **No arc selected:** only B's pointer shows, since it is for a question.
- **The arc selected:** A's pointer shows too, on the arc's ringed open work. C's never shows.
- The camera stays where it was put: measured across three seconds of the pulse playing (`cameraBefore` and `selected.camera`
  in `measurements.json`).

A pointer is no claim: it plants no flag, and the claim flag stays the only mark of where an agent works.

Pictures, 1440 x 960:

- `no-arc-selected.png`: the whole map: B's pink pointer on The command line, nothing else.
- `arc-selected.png`: the capability tree arc selected, the whole map: A's and B's pointers.
- `arc-selected-the-forest.png`: The forest, near: A's violet pulse at Running sessions beside the arc's ring, and A's flag on
  Story node render.
- `arc-selected-the-command-line.png`: The command line, near (dimmed, as the arc rings nothing on it): B's pointer at Arcs
  and increments.

Taken with `node --import tsx packages/forest/testing/view/agent-pointer/capture.mjs --retake`, which also counts every
pointer shown, with its colour, from the scene into `measurements.json`.

In the evidence bucket for #559, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `559/no-arc-selected.png`, `559/arc-selected.png`, `559/arc-selected-the-forest.png`, `559/arc-selected-the-command-line.png`.
