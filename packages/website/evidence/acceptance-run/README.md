# The website, as a visitor: model user acceptance (increment_d1c604205018, ADR-0825 D5)

A real browser reads the site the way a visitor would, and the harness mints each contract's verdict from what
the page itself and the network said. `pnpm record:acceptance <observations.json>` writes them to the verified
column as "acceptance run", with the run's note saying which copy of the site it visited.

## The journey (harness/visit.mjs)

Reproduce from the repository root with Node 24 and the Playwright Chromium build:

```sh
pnpm --filter @storytree/website build
node --import tsx packages/website/evidence/acceptance-run/harness/visit.mjs <outDir> --commit <sha> --evidence <path>
```

It serves `packages/website/dist`, or visits a published copy with `--url`. In order:

- With JavaScript off, at phone width: the heading and install command are visible, the command is the
  README's Install PowerShell block whole (1.2), a triple-click selects all of it, and the repository,
  license and LinkedIn links are visible and each leads to a real page (1.3). An address with no page answers
  404, and its link back goes home (1.4).
- The copy control copies exactly the visible command and says so; a denied copy says it failed and leaves
  the command (1.5).
- At 390 px, every header, footer, text-link and copy control is at least 44 px high, and keyboard focus on the
  command and copy control is drawn and not clipped by its panel (1.6). With text at 200% at 320 and 390 px,
  home and not-found headers do not overlap, nothing runs off the screen or scrolls sideways, and the copy
  control stays whole (1.7).
- With the 3D scene's code held back, the heading and install command are already there (2.3). Then, with
  software WebGL, the scene takes over: its canvas is what shows, the still is hidden, and it draws (2.1).
  With WebGL taken away, or the scene's code failing to load, the still stays and the page still works (2.2).

## Run of 2026-10-01 (2026-10-01/)

The site is not published yet: its address still serves the older site, because the publishing token waits
on the owner. So this run visited the **locally built site**, from e221468e8451, and its observations' note
says so. Every contract it checks is about the built page, so the verdicts hold for what will be published
from that commit; the run should be repeated against the published address with `--url` once it is live.

| Contract | Verdict |
|---|---|
| 1.2 the install command is the README's | passing, 1/1 |
| 1.3 readable without JavaScript, command selectable, links followable | passing, 5/5 |
| 1.4 the not-found page leads home | passing, 1/1 |
| 1.5 the copy control copies exactly the command; a denial is reported | passing, 2/2 |
| 1.6 phone-width controls: 44 px targets, visible unclipped focus | passing, 2/2 |
| 1.7 200% text at 320 and 390 px stays readable and whole | passing, 1/1 |
| 2.1 the live scene draws the saved plan's islands | passing, 1/1 |
| 2.2 without WebGL, or if the scene fails, the still and the page remain | passing, 2/2 |
| 2.3 text and install control come before the 3D code | passing, 1/1 |

LinkedIn answers any automated browser with its own status 999 refusal. The harness counts that as reaching
the page, not as a broken link: LinkedIn's server answered, and the address is not missing. The check's detail
says so. Any other status of 400 or more fails the check.

Pictures: `no-js-390.png` (the whole page with JavaScript off), `not-found-390.png`, `focus-390.png`,
`text200-*.png`, `forest-live-1440.png` (the scene drawing) and `forest-still-*.png` (the still, without
WebGL and when the scene's code fails).

## Run of 2026-10-01 against the published site (2026-10-01-published/)

The same journey, run with `--url https://crisp-globe-bf6v.here.now/` once CI had published the site: the
live copy was built from merge 89127d67 (Publish website run 36831078684, live at 07:35 UTC). Recorded with
`pnpm record:acceptance`, so the verified column now carries these verdicts.

| Contract | Verdict |
|---|---|
| 1.2 the install command is the README's | passing, 1/1 |
| 1.3 readable without JavaScript, command selectable, links followable | passing, 5/5 |
| 1.4 the not-found page leads home | **failing, 0/1** |
| 1.5 the copy control copies exactly the command; a denial is reported | passing, 2/2 |
| 1.6 phone-width controls: 44 px targets, visible unclipped focus | passing, 2/2 |
| 1.7 200% text at 320 and 390 px stays readable and whole | passing, 1/1 |
| 2.1 the live scene draws the saved plan's islands | passing, 1/1 |
| 2.2 without WebGL, or if the scene fails, the still and the page remain | passing, 2/2 |
| 2.3 text and install control come before the 3D code | passing, 1/1 |

1.4 fails because of the host, not the page: a missing address answers 404 with here.now's own bare
"Not found" text (`not-found-390.png`), with no header and no link home. The site's `404.html` is uploaded
and served at `/404.html`, but here.now does not use it for missing addresses, and its public docs name no
setting that would. For the same reason, 1.7's not-found half measured that bare page here, not the site's.
The local run showed no such failure, so this is a publishing gap; it is its own increment on the website arc
("The published site's missing pages show its own not-found page").
