# The Surfaces menu in Settings (ADR-0750)

The owner, 2026-09-29: a Surfaces menu in the app's settings listing every surface except Settings,
each with a plain name, a one-line description, an on/off switch where it can be switched off, and
its own settings, starting with the opening zooms ("take your leanings", `question_59a7410c2328`).

Unedited headless-Chromium screenshots of the **real desktop renderer bundle** (`apps/desktop/dist`,
1440 × 960), its real settings and surfaces actions on a throwaway home, and the snapshot named in
[capture.json](capture.json) restored into a throwaway Postgres. `capture.mjs` asserts each step, and
the smoke check's forest census (`smokeProblems`) passes in every shot.

| Shot | What it shows |
|---|---|
| [0-default-app.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/0-default-app.png) | Nothing set: today's app, unchanged. |
| [1-menu-default.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/1-menu-default.png) | Gear → Settings → Surfaces, everything on and at its default. |
| [2-menu-default-lower.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/2-menu-default-lower.png) | The rest of the list. |
| [3-menu-changed.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/3-menu-changed.png) | Sessions and Arcs switched off, the tree's opening zoom at Full size: each saved at once to `settings.json`. |
| [4-quiet-globe.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/4-quiet-globe.png) | The menu closed: no Arcs bar (the globe has the full height) and no Sessions list. |
| [5-library-and-tree-off.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu/5-library-and-tree-off.png) | Library and Capability tree off too: a solid globe with no Forest / Library buttons, and a story panel of the story's name and description alone. |

Run it after `node apps/desktop/build.mjs`, under the heavy lock:
`STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/surfaces-menu/capture.mjs`.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/app/evidence/surfaces-menu).
