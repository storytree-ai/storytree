# Home controls

Reproduce with Node 24 and the installed Playwright Chromium:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs controls --verify-controls
```

Contract 1.6's red proof lost focus to the document body as soon as copying started.
The earlier audit also measured a 27 px copy target and a clipped command outline with
1.97:1 contrast. The green browser proof now checks pending success and denial, duplicate
activation, focus after completion, Tab away without focus theft, and touch activation.
It also retains the no-JavaScript, exact clipboard content and 404 navigation checks.

At 1440, 390 and 320 px, all nine measured standalone controls are 44 px high and at least
44 px wide. Copy is 116 × 44 px. The command and button focus outlines are 3 px with
10.45:1 contrast against the panel, and their painted bounds fit inside its clipping edge.
All three views have one primary heading and zero horizontal overflow.

The frontend builder reviewed the captures against **Legible at the resting view**
(`principle_1e3418812c33`): the focused command has all four visible edges and the controls
remain readable. Against **The resting view is designed, not fitted**
(`principle_43ea5d4f68c4`), larger targets preserve the desktop hierarchy and the phone's
single reading column. This is measured evidence and a principle review, not owner acceptance.

The built home document is 6,175 bytes (2,067 gzip), CSS is 8,068 bytes (2,532 gzip), and
the copy script is 800 bytes (440 gzip). These are local byte measurements, not a claim
about the host's compression. No remote font is needed. After the shared renderer's flat-island
change in PR #333, the temporary scene entry is 1,252,132 bytes plus a 638-byte shared chunk.
It is still an eager stub: the scene, lazy loading and matching fallback remain site-b's work.
The now-outdated tree legend is recorded for the next copy increment.

[Desktop](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls/1440.png) · [Phone](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls/390.png) · [Narrow phone](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls/320.png) ·
[Command focus](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls/390-focus-command.png) · [Copy focus](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls/390-focus-copy.png) ·
[Measurements](measurements.json)

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 9 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/controls).
