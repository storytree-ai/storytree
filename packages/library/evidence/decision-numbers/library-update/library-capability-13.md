# 13 · Decision log

Record: `capability_78d6e026f902` (description).

Decision numbers do not collide, even across concurrent writers, and history reserves every number a decision has held. Other projects start at 1 and may allocate the next number automatically. In the project named exactly `storytree`, recording a decision requires an explicit number from 0.2's `adr new` until cutover. A narrow one-time repair gives an existing live decision the number in its own single `Full record: ADR-NNNN` line, provided no record of any type has ever held it. `editNote` still refuses number changes. The repair preserves the record's identity, other fields, and old number in history. Its dry run lists every proposed old → new number and any refusal without writing; it reserves nothing and the write checks again. The 53 founding books have no Full record line and remain untouched until cutover. A decision's status is proposed or accepted, and it can be superseded: the superseded decision is kept, and reads as superseded. A decision carries the load-bearing mark, who decided it, in their own words, and one composed statement.

13.1 · In projects with automatic numbering, decisions recorded at once from separate connections get distinct numbers, each higher than any before. A number held by another decision is never reused, including retired decisions and old numbers kept in history.

13.2 · A decision is superseded exactly when an accepted decision names it in `supersedes`. It stays readable, and a supersession loop is refused.

13.3 · Status and the load-bearing mark are stored and read back, and a decision written before status was is upgraded to carry one.

13.4 · A decision may carry one composed statement. A read returns it marked stale when the decision's text changed after it was written, and the full text is always readable.

13.5 · Only in the storytree project, numberDecision repairs a live decision once to the number in its own single Full record: ADR-NNNN line. Missing or ambiguous lines, mismatches, retired records, previous repairs, and numbers any record has ever held are refused without writing. Concurrent repairs cannot share a number or repair a record twice. The old number stays in history; editNote still refuses number. decisionNumberPlan lists proposed old → new numbers and refusals, including duplicate targets, without writing. Decisions without a Full record line are untouched.

13.6 · Recording a decision without an explicit number is refused in the project named storytree, explaining that numbers come from 0.2's adr new until cutover. An explicit unused number is accepted; other projects still auto-number from 1.

13.7 · numberDecisionsFromFullRecord previews by default; apply: true applies every eligible proposal through numberDecision and returns each refusal. Decisions already matching their Full record number are omitted. Duplicate targets are refused, the write checks history again under the project lock, and repeated bulk application writes nothing once all eligible repairs are complete.
