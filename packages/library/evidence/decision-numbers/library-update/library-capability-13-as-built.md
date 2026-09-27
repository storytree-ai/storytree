- **As built:** the decision is at version 2, with `status` (proposed or accepted), and optionally
  `number`, `supersedes`, `loadBearing`, `decided`, `authority` (0.2's basis, who scribed it, when,
  and the owner's words, which a stamp claiming his authority must quote) and `composed`. Its
  upgrade step reads an older decision as accepted, since it was recorded as decided. The number is
  handed out inside the save's all-or-nothing write, under the project's write lock: one past the
  highest any decision has ever held, from the history, so a retired decision's number is never
  reused. Capability 2's save gained a `sequence` field for it. A decision brought in with its own
  number keeps it unless another has held it (`NumberTakenError`); that is how the one-copy lane
  sets the `storytree` project's start (N1). Decisions already in a library keep no number until
  that lane gives them one; `editNote` never changes a number. `decision(id)` reads a decision as
  superseded exactly when an accepted decision names it, and `frontCovers` leaves it off its shelf
  (13-b). A composed statement remembers a fingerprint of the text it was composed against, and
  reads as stale once the text differs; editing the title does not make it stale. The agent link's
  tools and the seed record their decisions as accepted, as they were in effect before.

- **As built, one-time N1 repair:** `numberDecision` repairs an already-loaded decision only in
  `storytree`, to the number in its own single `Full record: ADR-NNNN` line, provided no record
  has ever held the target number. Existing history reserves the old number; the transaction
  rechecks collisions under the write lock. `editNote` still refuses number changes.
  `numberDecisionsFromFullRecord` previews by default and applies only with `apply: true`,
  returning every refusal. Already-correct numbers are omitted; founding books are untouched.
  The CLI is `storytree adr renumber --from-full-record --dry-run`, then `--apply` after review.
