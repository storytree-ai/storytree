# Settings panel — increment_c9c15aad51b2

Settings in the gear opens the agent link’s panel. Every reading has its value, meaning,
and default or set-by-you source. Context guidance accepts a positive whole number;
Library offers this computer or Cloud SQL with instance and account fields. The library
choice applies when the app next opens. Saves use the existing capability 10 writers,
and refusals cross IPC as data so Electron does not rewrite their CLI wording.

The panel and styles are exported from `@storytree/agent-link/view`. The app mounts it;
desktop main and preload carry the two IPC calls. The page imports no filesystem or
Postgres implementation. The app menu reads the desktop bridge when its settings actions
run, keeping the renderer and shared bridge file outside this lane’s changes.

The owner accepts the look. These unedited **Electron `pnpm desktop:smoke`** captures use
the supplied real snapshot, restored into a throwaway `STORYTREE_HOME`:

- [Gear with Settings enabled](menu-open.png)
- [Panel at the default](panel-default.png)
- [Panel after saving 420,000 tokens](panel-set.png)
- [Refused zero with the writer’s reason](panel-refused.png)
- [Electron smoke states](electron-capture.json)
- [Geometry and interaction results](capture.json)
- [Red proof](red.txt)
- [Pending library patch and supervisor checklist](library-update/README.md)

For the owner’s review: the panel uses the forest controls’ existing dark surface, border,
text and muted palette; “set by you” uses their warm selection accent (`#eadcae`). Meaning
stays beside the right-aligned value at desktop width. On a narrow window the controls
stack below their descriptions and the panel scrolls vertically. A native modal dialog
and explicit Tab wrapping keep the keyboard in the panel; Close and Escape return it
to the gear. These observations support review; they are not visual acceptance.

The focused red run failed on the missing settings actions/rendering and reserved menu
entry. Portable tests cover every reading, future numeric rows, writer dispatch and exact
refusal with unchanged bytes. The browser route additionally checks layout, keyboard save,
source changes, reopening persisted values, Cloud SQL editing, transport retry, failed-read
retry without invented defaults, focus, narrow fit and the forest smoke census.

Run geometry and interactions after building, under the shared heavy-work lock:

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/agent-link/evidence/settings-panel/capture.mjs
```

For native captures, use a throwaway home, a working X display, and Linux Postgres binaries
available to desktop. This Mint box reuses the gear lane’s extracted Xvfb and an ignored
node_modules link to the already installed Linux Postgres package. No system install is needed.

```sh
export STORYTREE_HOME=$(mktemp -d)
flock /tmp/storytree-heavy.lock node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json --project storytree
DISPLAY=:196 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/agent-link/evidence/settings-panel/electron-capture.mjs
```

The native driver resets only that throwaway home’s settings before each capture. All
four images are CDP screenshots of the real smoke window after interaction through its actual
preload and IPC; no fixture replaces settings there. This reuses the gear lane’s native-picker
capture path: Electron’s `capturePage` sometimes returns an earlier compositor frame, such as
the default before a confirmed save. CDP forces a fresh frame; no pixels are edited. The driver
brings the window forward and closes the already-exercised arc drawer to show the panel against
the forest. A brief table lock on the throwaway snapshot holds smoke’s final census read while
the screenshot completes; it changes no record, then releases so the real census and exit run.
Each smoke command still verifies the forest census and exits successfully. The headless route uses the same
writers and a separate temporary database, with explicit injected failures only in its
retry checks. Both drivers close their browsers and temporary database processes.

Guidance is NOT RUN: no role or supporting guidance changed. No decision-log curation
was needed. The supervisor applies story text and closes the increment; this lane does
not write the live library or accept the appearance.
