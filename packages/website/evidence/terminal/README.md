# Chapter 1 as a green-phosphor terminal (ADR-0879 D6, paced by ADR-0888)

Pictures of the website's first screen after it went back to storytree 0.2's old-terminal look. Seeded and
repeatable: the window jitter, typing rhythm and grain come from one fixed seed (`src/opening-seed.ts`), the
timers are the page's own, and the collapse is photographed by pausing its animations at fixed times.

Reproduce from the repository root:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/terminal.mjs terminal      # all of these pictures, about 4 minutes
node packages/website/evidence/capture.mjs opening --verify-opening   # the behaviour journey (contract 1.8)
```

Each viewport (1440x900, 390x844, 320x640) has the same seven pictures. What each one answers (ADR-0879 D1,
the visitor's seat):

| Picture | Shows | The visitor sees, feels, thinks |
| --- | --- | --- |
| `*-1-first-screen` | The dark CRT filling the screen; `storytree▌` top left; one terminal window with the prompt `~/shop $ Build me a shopping website▌` and a glowing RUN key; no counter yet; a dim line saying what the scene is and how long. | Sees a green terminal and nothing website-like; feels at home and curious; thinks "what's swarm? I'll press run". |
| `*-2-mid-swarm` | About 21 s after Run: the lead agent's lines, helpers powering on in a jittered grid (a pile on a phone), the arcade counter climbing, demands parked as solid blocks. | Sees the swarm grow and each window end on a question; feels the familiar overwhelm and laughs; thinks "this is my Tuesday". |
| `*-3-peak-finale` | The peak: the screen dimmed, `AGENTS: 12 ▲ · WAITING ON YOU: 12 · ANSWERED: 00`, the lead agent's honest report, the lead agent's honest report on attention ("I can't tell you which of these needs you"), `show me where to look →` and `i'll keep babysitting` (a bottom sheet on a phone). | Sees the honest report; feels caught, then relief; thinks "a map? show me". |
| `*-4-turn-squash` | The turn, 130 ms into the collapse: the last windows powering off while the whole image squashes vertically. | Sees the terminal being switched off like an old TV. |
| `*-5-turn-line` | The image squashed to one bright horizontal line. | Same beat, a moment later. |
| `*-6-turn-point` | The line shrunk to a short bar about to become a point. | Same beat. |
| `*-7-turn-glow` | The point of light, glowing before it fades; the globe then grows out of it. | Feels delight; thinks "something new". |

## The pace (ADR-0888 1.2-1.3)

`1440-pace-strip` is ten frames of one run at 2, 5, 9, 13, 17, 21, 25, 29, 32 and 35 s after Run. The clock is
0.2's (`web/src/scripts/storm-script.ts`), ported as a pure, seeded schedule in `src/opening-clock.ts`: about 4 s of
the lead agent thinking, helpers opening at 4.0, 8.0, 11.6, 14.9, 18.2, 21.0, 23.7, 26.1, 28.2, 29.9 and 31.3 s (gaps
shrinking from about 4.1 s to about 1.4 s), each helper's lines spaced 1.35x the base gap early and 0.8x late, the
last helper parking at 33.3 s, the lead agent at 34.2 s and the finale at 36.0 s. The journey asserts the first
helper at 3.5 to 4.8 s, the first gap of at least 3.5 s and the last under 1.6 s. The first three helpers carry the
jokes both a vibe coder and an engineer know (the deleted failing tests, the invented definition of done, the
fourth login system); the insider ones (CI attempt 7, force-push) come last. The words, the finale and the exit
label are the agent's draft in `src/opening-copy.ts`, for the owner to replace; he tunes the timing on this.

`1280-at-200pct-first-screen` and `390-at-200pct-first-screen` are the first screen at 200% browser zoom
(half the CSS pixels at twice the density): it reflows, with no horizontal scroll (scrollWidth 640 of 640 and
195 of 195, also asserted by the journey).

## Measured, not judged

- Windows: 12 (the lead and 11 helpers), 15 after the joke exit. The journey asserts no window covers the HUD row
  and no horizontal scroll at 1440, 1280, 390, 320 and at 200% zoom (640 and 195 CSS px wide).
- Contrast (before the scanline overlay, which darkens one pixel row in three by 28%): phosphor on window 15.6,
  dim banner lines 4.9, amber 12.3, amber dim 5.1, warning 9.5, footnote 5.0, sound-off key 4.8, demand blocks
  15.6 (green) and 12.3 (amber). Body text is 12 px or larger; the HUD keys are 11.5 px.
- Turn: windows power off 28 to 36 ms apart (at most 40; the whole stagger fits 400 ms), then the squash to a line
  250 ms, line to a point 200 ms, glow 250 ms. In the journey the hand-over to chapter 2 came 1.38 s after the
  click on a slow software-rendered browser (the journey asserts under 1.5 s).
- Run to finale: the choice appears 40.9 s of page time after Run (the journey asserts 36 to 46 s).

## Deliberate deviations from 0.2's recipe

- The sound-off key is `#5c8a70`, not `#57806a`: the recipe's colour is 4.4:1; this is 4.8:1.
- The RUN key is 12 px (recipe 10.5 px) and finale buttons 12 px, so no button label is below the 12 px floor.
- Title-bar status is 10 px uppercase as in 0.2; it is chrome, not reading text.
- Windows have a fixed top-left slot (4 columns on a wide screen, 3 on a tablet) with only a few pixels of jitter,
  rather than 0.2's heavily overlapping layout, so no text is hidden behind a neighbour.
- Older lines scroll off the top of a window like a real terminal, so a half-cut first line is expected.
