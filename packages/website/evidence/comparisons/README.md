# Dated research for the five explainers

Checked 2026-10-02 for `increment_98a360b0b12c`, under ADR-0857 D4.
The authoritative research is one library artifact, not a second copy in this folder:

```sh
pnpm storytree library read definition_b0b80acc7330
```

It contains 22 comparisons: four for story maps, five for capability health,
four for knowledge, four for sessions, and five for arcs. Each row cites primary
documentation and its observation date, separates documented facilities from
research judgments, and gives the limit of the comparison. Each explainer has
two lines grounding Storytree's approach in current decisions.

An independent source review opened every cited primary page. A separate
librarian pass checked the Storytree decisions, found no duplicate artifact,
and retained the research behind `decision_850c55d937c6`. No accepted decision
or generated guidance changed. The archived Codex plan recipe is explicitly
identified as an optional historical pattern. No competitor was installed or
benchmarked, and no general superiority claim is supported.

The research raised `question_4800f4f38f6a` on the opening arc. It asks whether
to investigate adoption/adaptation of a specialist maintenance view or set that
broader task aside for this opening. It holds Chapter 2's copy, not the research
landing. Discovery, purchase and implementation are separate decisions.

```sh
pnpm storytree library read question_4800f4f38f6a
pnpm storytree arc show arc_f5c2de151771
```

This increment changes no product code or public tour copy. No test was added
for research prose, in accordance with ADR-0623. The existing scoped gate checks
the website package; factual verification is the primary-source review above.
Friction and health drains were empty at this landing.
