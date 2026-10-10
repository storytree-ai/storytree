# Recorded capability claims, as flags

Re-taken 2026-10-10 on the Mint box for increment_56c04a002c2a, the website's half of ADR-0968: a claimed capability carries a flag in its session's colour, and on an island with no code yet its share of the island is marked as a lot, a dashed line with the flag in it. The renderer's half (the flag, the lot, their arrival and lift) landed in #1081; this page's replay now lets signing in's claims through before its code lands, which the map chapter's five steps (ADR-0891, amended twice on 2026-10-10) show in their second step. Earlier captures in this folder showed ADR-0923's outlines; they are replaced.

## What the replay shows

Signing in's session staked its capabilities one at a time while the island had no code. The replay gives the island an equal share for each of its five capabilities from the first claim, so each flag has ground to stand in, and hands the globe every claim the record holds on it (`mapRecording`, `src/map-recording.ts`). Its code reached the map when its pull request merged at 02:06:32, after the last claim was released; the surveyed territories then take the lots' place one at a time, in the order the agent landed them, a millisecond apart.

| Recorded moment (5 October 2026, UTC) | Map step | What the globe shows |
| --- | --- | --- |
| 01:53:07 planned | 2, line 1 | Signing in rises plain: no share, no flag. |
| 01:53:10 | 2, line 2 | The shop server's flag drops into its lot; the island shows its five equal shares. |
| 01:56:24 to 01:56:40 | 2, line 3 | The session's flag drops in; the shop server's lifts away. |
| 01:57:11 to 01:57:12 | 2, line 3 | The session's lifts; the page shell's drops in. |
| 01:57:34 to 01:57:35 | 2, line 3 | The page shell's lifts; the sign-in page's drops in. |
| 01:58:22 to 01:58:24 | 2, line 4 | The sign-in page's lifts; sign-out's drops in and stands while the sessions list is open. |
| 02:06:32 (pr1) | 3, line 1 | Sign-out's flag lifts; the shop server's territory takes the whole island, then the session's and the page shell's split it. |
| 02:46:21 (pr5) | 4 | Checkout's two capabilities with code carry its agent's flag, in its blue `hsl(214, 80%, 68%)`; its third has none. |
| 02:46:51 (pr4) | 4 to 5 | Every flag has lifted. |

All five of signing in's flags are in the session's colour, `hsl(300, 80%, 68%)`, the same as its row in the sessions list. The same session's claims on three of browsing's capabilities (by 02:00) fall on an island not shown until step 4, so they are not seen. The cart and checkout have no ground drawn for their claims while they have no code (the shop's record gives them no shares), so in step 4 only checkout's flags at pr5 show: the chapter adds no mark of its own.

## What the capture checks

`recorded-claims.mjs` serves the built site, plays the map chapter at the tour's own 0.75×, and reads every rendered frame through the globe's capture seam (objects named `territory-claim:<capability>`, with their `claim-lot:<capability>`). At 1440 and 390 wide it checks that:

- signing in rises with no flag;
- each of its five capabilities' flag draws in more than two frames while it is claimed, each in the session's colour and in a lot, and no other flag draws then;
- no flag stands once its code is on the map;
- at pr5 exactly checkout's two flags draw, with no lot, and none before;
- no flag stands in the health step, or in the agents chapter's claim and parallel steps;
- hiding only the claim marks changes no health word or fill, and changes visible pixels: 516 at 1440×1000 and 119 at 390×844, one flag with its lot (a phone draws the flag as its small-scale dot).

`observations.json` records each flag's frame count, the stages' recorded times and plan seconds, and the pixel counts. The first island's pictures are in [../map-five](../map-five/README.md).

## Pictures

| Moment | Desktop | Phone |
| --- | --- | --- |
| The agents chapter's claim step, How open | [1440](1440-agents-claim.png) | [390](390-agents-claim.png) |
| Parallel sessions, How open | [1440](1440-agents-parallel.png) | [390](390-agents-parallel.png) |

## Reproduce

From the checkout root:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node --import tsx packages/website/evidence/recorded-claims.mjs
```

With no argument it writes here and the first island's pictures to `../map-five`; given a folder, it writes everything there. It does not replace the page with a fixture, synthesise claims, connect to the live library, submit a waitlist entry, or send analytics events.

Evidence was captured on Mint with headless Chromium/SwiftShader. These are desktop and phone viewport checks, not native device or hardware GPU performance measurements.
