# A proposal held on the owner's question reads waiting on you — ADR-0909 D2

The actual desktop renderer, captured unedited with headless Chrome 154 on the owner's Windows
laptop over an isolated Postgres. Dark theme, 1440 × 960. Nothing in the owner's library or
running app is opened or changed.

- [Before: the renderer built without the fix](before.png) ([readings](before.json))
- [After](after.png) ([readings](after.json))

The fixture follows the board the owner reviewed on 2026-10-05. *One owner-approved waitlist row*
holds its proposal *Send one live waitlist entry* on his question: before, that bar was grey and
read open; after, it is yellow and reads waiting on you. *The land follows merged work* has one
proposal, held on a question raised on *The app keeps up*: before, the lane read **ready · 1 to
take** although nothing in it could be taken; after, it reads **queued**. *Promoted releases for
first users* has two free proposals, one whose body names the machine it needs: both still count
as **ready · 2 to take** (ADR-0909 D1, D3).

Reproduce from the repository root (`--before` records without asserting, for a build of the
renderer without the fix; `--retake` writes here instead of a scratch folder):

```sh
node apps/desktop/build.mjs
CAPTURE_CHROMIUM="C:/Program Files/Google/Chrome/Application/chrome.exe" node --import tsx packages/arc-surface/evidence/held-proposal/capture.mjs --retake
```
