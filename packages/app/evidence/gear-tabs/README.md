# The gear menu's tabs: Sessions, Library and Surfaces replace the Settings catch-all

The owner, 2026-09-29: "i dislike have a setting menu that holds everything … i would put them under
a sessions menu. We should also have a Library menu, and then a surfaces menu." Tabs, in order:
Projects · Sessions · Library · Surfaces · Updates · Help; no visible "App" title.

Unedited headless-Chromium screenshots of the **real desktop renderer bundle** (`apps/desktop/dist`,
1440 × 960), its real settings and surfaces actions on a throwaway home, and the snapshot named in
[capture.json](capture.json) restored into a throwaway Postgres. `capture.mjs` asserts the tab order,
which settings each tab shows, that the Sessions and Library switches stay under Surfaces, and that
looking through the tabs saves nothing.

| Shot | What it shows |
|---|---|
| [1-sessions.png](1-sessions.png) | Sessions: context guidance, the time before a quiet claim can be taken over, and the time before a finished session leaves the list. |
| [2-library.png](2-library.png) | Library: where the library lives, on this computer. |
| [3-library-cloud-sql-fields.png](3-library-cloud-sql-fields.png) | Google Cloud SQL chosen (not saved): its connection fields. |
| [4-surfaces.png](4-surfaces.png) | Surfaces: the list from the Surfaces menu, unchanged, every on/off switch and opening zoom. |

Run it after `node apps/desktop/build.mjs`, under the heavy lock:
`STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/gear-tabs/capture.mjs`.
