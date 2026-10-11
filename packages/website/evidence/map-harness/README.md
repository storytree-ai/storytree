# The map chapter says storytree works with your harness, and its arcs step is small (increment_a9477c147d25)

The owner, 2026-10-11, after looking at the published map chapter: the arcs panel "covers the whole screen", it should have the
sessions list's smaller footprint without the arc detail panel, and a step before it should say storytree works with your
existing agent harness, with the Claude Code and Codex marks. ADR-0891 carries the in-place note (seven steps).

| # | Step | Lines | On screen |
|---|---|---|---|
| 2 (new) | Works with your harness. | "Storytree works with your existing coding harness." ★ | The bare shop globe step 1 leaves; beneath the line, Claude Code's and Codex's marks with their names |
| 3 | Plans of work are arcs. | "Tell your agents what you want to build and they will set up a plan of work." ✎ (the second line is cut) | The arcs as a small list, no detail panel; the shop's first arc outlined and named "a plan of work: an arc" |
| 6 · line 2 | Agents claim their work. | unchanged | The same small list: the arc's four parts as ovals, parts 2, 3 and 4 each under its session's flag |

★ the owner's words, ✎ his words with the grammar tidied; titles, How and Why are DRAFT (`src/tour-copy.ts`).

**Pictures.** `before/` is `main` at bc9039d9, `after/` this branch, at 1440×900 and 390×844 on SwiftShader, each a few seconds
into its line while the step plays (`before/` has no harness step). `seen.json` records where the arcs list stands and the
labels on show. Made with `node packages/website/evidence/map-harness/capture.mjs` after `pnpm --filter @storytree/website build`
(`--dist <main's dist> --before` for `before/`).

**Choices made here.**
- On a laptop, while the tour plays, the arcs drawer is a 400px list under the page's name and above the card (about 4% of the
  screen, was the top half with its detail panel); the globe stands whole beside it. A phone keeps its band at the top (2.18),
  as before. The detail panel and the Expand control are hidden while the tour plays, at every width; free play keeps the whole
  surface. Only the website's stylesheet changed: the arc surface package needed no list-only option.
- The arc is pointed out with an outline round its row and the words beside it (below the list on a phone, where the list is
  full width), styled as the map lines' labels. It reads the list's own rows, so it shows without WebGL too: the no-WebGL
  journey (`evidence/tour.mjs`, `verifyTour`) checks it.
- The claims step's second line: the small list shows the three held parts as the arc's second, third and fourth ovals, each
  under its session's flag, and names them on hover; it does not name them in words on screen. The line stays, as asked.
- The harness marks are data (`harnesses` in `src/tour-copy.ts`): one more harness is one more entry. Storytree's first-run probe
  looks for Claude Code and Codex only, so the step names no other.

**Where each mark came from** (each its company's own published mark, used unaltered at the size served, beside its name, as a
plain "works with" reference; neither implies endorsement):
- `public/harness/claude-code.png` (266×266): the icon Anthropic (verified publisher) publishes for its "Claude Code for VS Code"
  extension, from the Visual Studio Marketplace gallery, `anthropic.claude-code` 2.1.296, asset
  `Microsoft.VisualStudio.Services.Icons.Default`, fetched 2026-10-11.
- `public/harness/codex.png` (385×385): the icon OpenAI (verified publisher) publishes for its "Codex – OpenAI's coding agent"
  extension, from the Visual Studio Marketplace gallery, `openai.chatgpt` 26.51007.21434, asset
  `Microsoft.VisualStudio.Services.Icons.Default`, fetched 2026-10-11.
