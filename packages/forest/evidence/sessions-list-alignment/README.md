# Sessions list: bars line up, names fit, bars fill

Increments `increment_8935a131987d` and `increment_ce9f45c6cce8` (arc `arc_895e232031b0`); forest capability 7,
ADR-0737.

`check.tsx` renders the real `SessionsList` with `src/view/styles.css` in headless Chromium, rows with different
labels, badges and readings (short, two 40-character names, "+1 · needs you", a Codex row), at 1440px and 420px, and
asserts every row's bar starts at the same x, every total ends at the same x, and a 40-character name shows whole at
the default width.

- Red (`6a1ad93`, storytree-ai/storytree#184): at 1440px the bars started at 335 / 335 / 508 / 393; at 420px at
  196 / 196 / 278 / 250.
- Green (#184): the list has a fixed width (`min(470px, 100% - 32px)`) and the label takes the free space uncapped,
  so the bar and total sit flush right on every row: 358 at 1440px, 326 at 420px (`edges.json`, `rows-*.png`).
- ADR-0737 (#187): the "off plan · N files" badge and its evidence panel are gone. The label column at the default
  width is about 290px; two wide ordinary 40-character names fit unclipped at both widths, which is where the claim
  reason limit (agent link contract 5.16, `CLAIM_REASON_LIMIT = 40`) comes from.
- Filled bar (contract 7.6): 1,000,000 tokens span the bar on every row. Claude Code rows split into Injected (grey),
  Grounding (blue), Implementation (amber) and Other (muted) by the reading's composition (agent link 9.8), with
  marks at 700K and 850K; the Codex row is one raw segment with no marks. Hover gives the numbers.
- Legend and 120px bar (increment `increment_950cdb5c388a`, owner's answer to `question_6bdc148e3443`): the header
  carries Injected / Grounding / Implementation / Other with swatches that read the same colour tokens as the
  segments (`--group-*` on `.sessions-list`), so the two cannot drift. The bar is 120px (59px under 600px). To keep a
  40-character name whole, the panel grew by the same 55px (`min(525px, 100% - 32px)`) instead of the label giving it
  up: at 470px the label measured 238px against a 249px name. Red `e571fee`: no legend entries.
