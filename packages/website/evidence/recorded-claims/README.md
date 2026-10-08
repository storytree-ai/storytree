# Recorded capability claims

The website teaches the representation settled in ADR-0923: a session outlines the surveyed territories of the capabilities it claims. Its increment reserves a job on the arc; it supplies no map mark. The four map steps keep their approved spoken lines, recorded timing, and the pathway reveal from #842. The map's How and the agents chapter's draft explanation now describe capability outlines.

Two mismatches appeared in the real browser proof:

- On base `260ad961`, the map advanced its surveyed scene before the renderer advanced its recorded sessions. One Browsing outline flashed at the `pr3` boundary, then two Cart outlines appeared alongside Checkout at `pr5`. Checkout also briefly remained outlined after release. The browser check failed before the fix; [the captured wrong claims](before.json) retain the evidence.
- The agents chapter combined its 02:33 claims with the final survey, showing six outlines on code surveyed later. The 2.17 browser check failed with six outlines where that moment supports none.

`recordedFrame` now supplies map land, health and claims from the same stage. The agents chapter uses the survey reached at its timestamp and keeps its existing recorded sessions/arc reading. These changes are confined to the website; the renderer and saved recording are unchanged. The early survey also restores the unsurveyed build-progress labels. A phone tag can move beside a blocking label's edge, within the screen, to clear those taller labels; the chapter sequence and camera framing stay the same. Below 620px tall, the agents chapter omits the secondary progress meter so the island names remain visible.

## What the replay shows

The table gives seconds from the beginning of Pathways at the default 0.75× speed. These boundaries come from the same growth plan and pathway lengths the page uses; the browser capture also observes every rendered frame, checks the claimed capabilities/colours, and measures the visible interval.

| Recorded stage (5 October 2026, UTC) | Step seconds at 0.75× | Visible claims |
| --- | ---: | --- |
| `pr4-building`, 02:35:08.955 | 3.85 | None: the three sessions' claimed capabilities have no surveyed territories. |
| `pr5-building`, 02:35:17.256 | 7.69 | None, for the same reason. |
| `pr3`, 02:40:02.942 | 11.54 | None: Cart and Checkout still have no surveyed intersection. |
| `pr5`, 02:46:21.000 | 15.77 | Two Checkout territories outlined in its blue, `hsl(214, 80%, 68%)`. Its third claim has no surveyed territory. |
| `pr4`, 02:46:51.304 | 20.00 | None: every session has released. |

The visible window is about 4.2 seconds at the default speed (about 3.17 seconds at 1×). There is no moment with all three session colours on the map. The agents chapter's earlier 02:33 view has no outlines; its list carries the three sessions and their colours.

Health follows the dated record. Checkout is proposed at `pr5` and untested at `pr4`; that recorded transition is retained. The capture verifies the recorded health words and checks that hiding/restoring only the outlines changes no health word, fill or opacity. Pixel comparison of the same rendered frame proves the marks survive projection: 510 pixels at 1440×1000 and 64 at 390×844 differ when only the two outlines are hidden. The existing Health step still provides the later yellow-to-green demonstration.

## Pictures

| Moment | Desktop | Phone |
| --- | --- | --- |
| Before the claimed code is surveyed | [1440](1440-before-survey.png) | [390](390-before-survey.png) |
| Checkout's two claims | [1440](1440-checkout-claimed.png) | [390](390-checkout-claimed.png) |
| After release | [1440](1440-released.png) | [390](390-released.png) |
| Claim explanation with How open | [1440](1440-agents-claim.png) | [390](390-agents-claim.png) |
| Parallel sessions with How open | [1440](1440-agents-parallel.png) | [390](390-agents-parallel.png) |

See: a short blue outline on Checkout, then its removal; three session colours in the earlier list with no invented map marks. Feel: the picture follows the dated work. Think: an outline identifies a capability's claimant; health is a separate signal. On a phone the outline is small at the existing overview scale; the capture proves it is visible without changing that framing.

## Reproduce

From the checkout root:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node --import tsx packages/website/evidence/recorded-claims.mjs /path/to/output
```

The capture serves the actual built website, follows its tour controls at default speed, and observes the globe's existing capture hook. It checks numbered website behaviours 2.16 and 2.17. A second pass pauses for pictures. It does not replace the page with a fixture, synthesize claims, connect to the live library, submit a waitlist entry, or send analytics events. `observations.json` records the rendered interval, colours, health and pixel measurements.

Evidence was captured on Mint with headless Chromium/SwiftShader. These are desktop and phone viewport checks, not native device or hardware GPU performance measurements.
