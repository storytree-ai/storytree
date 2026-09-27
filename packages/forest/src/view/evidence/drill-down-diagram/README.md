# The drill-down: a description and a clickable diagram

ADR-0659, 2026-09-27. The owner found the story panel too much prose. It is now
the story's sentences and its capability diagram. The capability clicked in the
diagram shows below it, and no front cover shows in the panel.

The captures render `renderStoryPanel` on its own, with the app's real
`styles.css`, for a panel shaped like the forest story (six capabilities, two in
other stories). They are a look for the owner's eye, not a test. The unit tests in
`story-panel.test.ts` and `drill-down.test.ts` (contracts 4.6 to 4.8) hold the
behaviour.

- [opened-dark.png](opened-dark.png) and [opened-light.png](opened-light.png): the
  panel as a story opens, on its first capability not yet landed (Drill-down,
  reported failing, dashed until it lands). Other stories' boxes sit muted at the
  top and cannot be clicked.
- [clicked-dark.png](clicked-dark.png): after clicking Story node render, with its
  contracts unfolded.

The diagram now runs top to bottom, in rows by build depth. Laid out left to right
in columns, a five-deep story shrank to fit the narrow panel and its labels became
unreadable.
