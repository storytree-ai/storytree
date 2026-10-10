# The claim mark: the alternatives the owner chose from

On 2026-10-10 the owner called the globe's claim mark, an inset band along a claimed territory's border (ADR-0923 D1), "pretty ugly" and asked for alternative designs for the animation. This folder is the comparison he chose from. He picked **B, the flag**: "B, doesnt need the pulse from E, the pulse from B is enough." ADR-0968 records the decision; the renderer change is increment_c452c317aee2 on arc_baecc05d1adf.

## What is here

- `claim-marks.html`: the page. Today's band and six replacements (halo, flag, hatch, name chip, pulse and pin, lift) each play through a claim's whole life on one clock: it arrives, is held, goes quiet, then lands or is released. Each is drawn at the tour's close-up (island 480 px), the resting globe (90 px) and a 390-wide phone (200 px close, 30 px at rest), in two scenes: three sessions on neighbouring capabilities, and an island with no code where one session claims every capability. It is published, for the owner's account, at https://claude.ai/artifact/3KUSi7AMdi9FmNc1GW42WP.
- `stills/`: today's band cropped from the site's capture (`today-1440.png`, `today-390.png`), the strip of all seven at four moments, and the band and the flag at the page's own sizes.
- `tools/sample.mjs`: reads colours off the site's captures and crops today's band. `tools/shots.mjs`: captures the stills.

## Reading it

The islands are drawings on a canvas, made to resemble the real ones. They are not the renderer. The colours and today's band width are measured from the site's captures; the mock-up's length unit is about two of the renderer's ground units (the band, 1.2 ground units, measures 0.6 mock units), an estimate from one capture.

Three things on the page differ from what was decided:

- The page recommends the flag with alternative E's territory-wide flash on arrival. The owner declined the flash; the flag's own drop and single ripple is the arrival.
- The page's held flag waves. The decided flag stands still while a claim is held.
- The page's three-session scene gives a capability with no code a lot on an island that already has code. The owner chose lots only on islands with no code at all.

## To look at it or capture it again

    node docs/design/claim-marks/tools/shots.mjs

writes `preview.html` beside the page (the page wrapped in a document, which is what a browser needs to open it from disk) and the stills. Both scripts run from the checkout root and use the website package's browser driver.

| Moment | All seven | The flag |
| --- | --- | --- |
| A third claim arriving | [strip](stills/strip-neighbours-arriving-third.png) | [flag](stills/flag-arriving-third.png) |
| Held | [strip](stills/strip-neighbours-held.png), [still forms](stills/strip-neighbours-held-still.png) | [flag](stills/flag-held.png) |
| One session quiet | [strip](stills/strip-neighbours-quiet.png) | [flag](stills/flag-quiet.png) |
| An island with no code, all claimed | [strip](stills/strip-first-held.png) | [flag](stills/flag-first-island-held.png) |

Today's band, the mock-up of it: [band](stills/band-held.png). The site's capture of it: [1440](stills/today-1440.png), [390](stills/today-390.png).
