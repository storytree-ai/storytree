# Each map line labels the thing it is about (ADR-0891, amended 2026-10-10; contract 2.21; increment_a934963476bd)

While a map-chapter line is the current one, one small label names the thing it talks about, and it fades as the line passes
(at once with reduced motion). Its words are read from the shop's record at that moment, so they are always true to what the
globe shows. The labels follow ADR-0984's six steps, which replaced the five the increment was written against.

| Step · line | Label | Where | Shown down to |
|---|---|---|---|
| Stories and pathways · 1 | "a story" | signing in, once it has risen | 601px (laptops) |
| Stories and pathways · 2 | "the cart needs signing in" | the cart's page → signing in's page shell, on its own stretch of road | 390px |
| Capabilities and your code · 1 | "a capability" | the shop server, the first territory to arrive | 601px |
| Capabilities and your code · 2 | "server.js · 110 lines" | signing in's largest file, its size from the 02:06 survey | 390px |
| Capabilities and your code · 3 | none | the story panel is the subject | |
| Agents claim their work · 1 | "Part 2: product page, sorting, cart" | the first flag (product page, 02:28:12), named by its session, which named itself at 02:27:06 | 601px |
| Agents claim their work · 2 | none | the arcs panel is the subject | |
| Agents claim their work · 3 | the sessions list is pointed out | a brief green outline round the list, not a label on the globe | every width |
| Health · 1 and 2 | "not proved yet" while checkout is yellow, then "tests passed" once the 03:08:57 survey turns it green | checkout | every width |

Noise is the owner's test. Each labelled line was pictured at 1440, 1280, 390 and 320, and `labels.json` records, for each
picture, the label on screen and whether it covers the card, the bar, a panel, the sessions list or an island's name, or runs off
screen. Where a label crowded something it was dropped at that width rather than shrunk:

- The flag's session name covered Browsing's name at 390 and 320, so a phone has no label on the claims step's first line.
- At 320 the pathway's words covered Cart's name and the file's covered Signing in's, so the narrowest phone keeps only checkout's health.
- "a story" and "a capability" stay off phones, so a phone shows at most one label in a step.

With those drops no picture records a crowd. The island's nameplate already names signing in, so its label says only "a story"
rather than doubling the name.

Pictures: `<width>-<step>-line-<n>.png` as the line is said (`-green` for the health step held near its end), and
`…-before.png` for the same moment with the labels hidden. Made with `node packages/website/evidence/arrival/capture.mjs --only mapLabels`
and `… --only mapLabels --before`, after `pnpm --filter @storytree/website build`, on SwiftShader at the tour's own 0.75×.
