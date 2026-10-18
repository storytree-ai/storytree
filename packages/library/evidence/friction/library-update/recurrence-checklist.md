# Recurrence ranking library update

For increment `increment_01aa9291b333`; supervisor applies after this PR merges.
Source: read-only snapshot `2026-09-27T14-03-38-576Z.json`. Compare current fields before applying; preserve intervening edits.

- [ ] Apply `recurrence.patch`: amend Queues contract 5.2 in place (`contract_cebbe02f1866`) and its as-built note (`definition_6def5775dc8f`).
- [ ] Curate the existing founding decision `decision_13c403f3a480`: its snapshot text says “each pass drains at most the three oldest friction reports filed by another session, so the librarian never marks its own homework.” Note in place that ADR-0716 F3 changes the order to most recurrences first, oldest on ties; the cap and own-branch exclusion remain. This lane writes no decision records.
- [ ] Read the edited fields back and confirm persistence.
- [ ] Close this increment with the PR and red/green SHAs in `/tmp/friction-trio-close.md`.

No live library writes, claims or questions. No additional durable guidance or memory needed graduation.
