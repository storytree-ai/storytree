# A proposal held on the owner's question reads waiting on you — ADR-0909 D2

The actual desktop renderer, captured unedited with headless Chrome 154 on the owner's Windows
laptop over an isolated Postgres. Dark theme, 1440 × 960. Nothing in the owner's library or
running app is opened or changed.

- [Before: the renderer built without the fix](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/held-proposal/before.png) ([readings](before.json))
- [After](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/held-proposal/after.png) ([readings](after.json))

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

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 2 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/held-proposal).
