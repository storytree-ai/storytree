# App-owned guided globe

The static capture imports the public forest, knowledge-core and arc-surface views. It contains no camera math, picking rules, territory renderer or copied app controls. Knowledge-core and arc-surface already exported the required views; the forest now exports `PlanetView` and its typed controls.

Run `node --import tsx packages/forest/evidence/guided-globe/capture.mjs` from the checkout. Add `--retake` to replace these pictures and observations; ordinary runs write to the capture kit's scratch directory. The ignored `dist` is rebuilt each time. This reuses the desktop capture runner and the previously saved code-rows reading, adding one explicitly synthetic claim to exercise the session-tint switch. It does not fetch a live library or change the website.

Contract-named unit tests went red before implementation for forest 3.21–3.23 (camera stops, independent presentation and screen positions) and world 6.6 (framing/offset). The browser additionally checks world 6.7 against mounted geometry: independent sea, ground and road switches retain the camera, canvas and scene. It exercises file targeting, hidden target reads in Library, all forest switches, plain/health transitions through session emphasis, resize, the public arc mount, and teardown. `measurements.json` and the two recorder observation files are minted by the successful capture script.

- `file-stop.png`: an app-owned stop faces a real file; a pointer uses the public CSS-pixel position beside a clear card.
- `plain-territories.png`: health fills are hidden, retaining territory boundaries and files.
- `knowledge-core.png`: the same mounted canvas hides its exterior and frames its core.
- `phone-stop.png`: the target pointer stays separate from the bottom card at 390 × 760. This is camera/card evidence; the deliberately close framing still crowds some existing island names.

Independent review inspected all four pictures and the code. It found the session-emphasis material-copy regression; the new 3.22 test reproduced it, and both unit and mounted checks now pass. The reviewer accepted the camera/card/pointer evidence with the mobile-label limitation above. A separate label-layout session is not warranted by this deliberately zoomed-in capture.

The website can consume these public controls in its Chapter 2 increment. This prerequisite includes no Chapter 2 copy, free play, waitlist change or answer to the research question.
