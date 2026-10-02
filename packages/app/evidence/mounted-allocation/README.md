# Mounted App allocation

Run `STORYTREE_EMBEDDER=off node packages/app/evidence/mounted-allocation/prove.mjs`
from this checkout, with the Desktop workspace dependencies and Playwright Chromium installed.
Use `--retake` to write the runner's pictures and per-view measurements here; otherwise those
go to its scratch directory. The measured allocation inputs and provenance are refreshed here
after a successful proof. Regenerate the combined map with `pnpm survey:coverage app`.

The existing Desktop capture kit builds and serves the real renderer. Its database bridge is a
stand-in with two small project trees. Project choice and surface settings use the real App
actions against a temporary home, removed afterward. This proves mounted Chromium behavior,
not native Electron lifecycle, live database reads, or Windows installation.

- App 2.1: both projects are listed, a rejected choice leaves retry available, and a successful
  choice replaces the forest and closes the menu. App 2.5: an empty list clears the canvas and
  asks for a folder; recovery follows the saved choice.
- App 3.7: switching Arcs and Library off changes the mounted page, survives a reload, and
  switching Arcs on mounts it again. App 3.3: the frame's census names the whole project.

Node's precise coverage measures the actual capture build, bridge, launch, output and runner.
It is drained at the project/surface boundary; startup belongs to the project proof and later
surface execution to the surface proof. Chromium coverage includes real renderer reloads.
Each runtime script must equal the generated script paired with its source map. The existing
recorder accepts only App and same-checkout Desktop sources; Forest and World bundle members
receive no App allocation. Each proof contributes once to its leading capability number (2 or
3); additional contract numbers in its description do not add weight.

`observations.json` names the source commit, measured files and bundle/map hashes.
`trace.json.gz` retains the actual V8 function ranges with those hashes; bundles are reproducible
from the named source and are not copied here. `surfaces.png` shows the final mounted page.

The proof failed with the renderer's surface-redraw callback intentionally disabled in
`efb65fcd`: “3.7 switched-off Arcs is unmounted”, actual 1, expected 0. Restoring it passed.
The green source `d8bdc26d` also removes the unused plain-list renderer and its obsolete tests,
imports the current empty state directly, and moves the capture seeder under `testing/`.
The existing App 2.7 mounted-menu test now uses the same typed fake bridge, giving the public
capture barrel ordinary import reach while preserving its existing section-action assertions.
