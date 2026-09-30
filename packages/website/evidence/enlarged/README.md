# Enlarged-text layout · 2026-09-30

Contract 1.7 protects readable headers, headings and copy controls when text is
larger. The browser proof first failed on the shipped page: home and 404 header
labels overlapped at 320/390 px; at 320 px the home headings and copy control also
extended outside their available space. The document grew to 331 px.

The fix allows the header and command heading to wrap, preserves the wordmark's
width, and lets long heading words wrap when they cannot fit. It adds 146 emitted
CSS bytes. No text size is reduced to make the proof pass.

## Reproduce

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs enlarged --verify-enlarged
```

The proof doubles each element's original computed font size before measuring
rendered text ranges and control bounds. **This is injected text enlargement,
not native browser zoom.** It checks home and 404 at 320, 390 and 1280 px, exercises
keyboard navigation and pointer/keyboard copy activation, and reruns the existing
ordinary 320/390/1440 px controls, no-JavaScript, clipboard and 404 proofs.

All enlarged cases now have no overlap, clipped copy control, heading overflow or
horizontal page overflow. The ordinary controls retain 44 px target heights and
fully contained 10.45:1 focus indicators.

## Pictures

| Evidence | Before | After |
| --- | --- | --- |
| Home header, 320 px with doubled text | [Overlapping labels](before-header.png) | [Separate rows](home-text200-320-header.png) |
| Copy control, 320 px with doubled text | [Clipped label](before-command.png) | [Wrapped control](home-text200-320-command.png) |
| Home heading, 320 px with doubled text | [Measured overflow](before-measurements.json) | [Contained text](home-text200-320-heading.png) |
| 404 header, 390 px with doubled text | [Measured overlap](before-measurements.json) | [Separate rows](404-text200-390-header.png) |

Ordinary views: [desktop](1440.png), [phone](390.png), [narrow phone](320.png).
Full geometry: [before](before-measurements.json), [enlarged after](enlarged-measurements.json),
[ordinary after](measurements.json). Additional header, heading and command captures
cover all measured sizes in this folder.

## Independent review

The frontend-builder reviewed the captures against the library principles:

- **Legible at the resting view:** enlarged wordmark/navigation text is separated
  by roughly 17 px vertically. The enlarged copy label fits inside its button.
- **Meaning outranks appearance:** at 320 px with doubled text, “Software” and
  “storytree” split within words. This wrapping tradeoff keeps every letter readable
  and contained.
- **The resting view is designed, not fitted:** ordinary desktop and phone captures
  are byte-identical to the prior copy landing's captures.

No new layout defect was found. These pictures and observations do not record the
owner's acceptance of the look. The unfinished project-map mount remains site-b's work.

## Weight

Local raw / gzip bytes: HTML 6,046 / 1,975; CSS 8,214 / 2,555; main script 800 / 442.
Those three total 4,972 gzipped bytes. The pending renderer stub remains 1,252,134
raw bytes plus a 638-byte shared chunk; lazy loading and the real scene remain with
site-b. These are local comparisons, not measured here.now transfer sizes.
