# Library update: close ends claims and terminal release

These files are **read-only landing evidence**, not repository sources or a
replacement library. The authoritative 0.3 library is on the owner's laptop and
was neither read nor written by this lane. No decision record is included; the
laptop supervisor owns that record and the increment's closure.

The [changes.patch](changes.patch) supplies additions to two existing capability
records in the people's command-line story. Its old sides contain only identifying
headings, not a claimed export of the live text. The accompanying
[arc-family excerpt](stories/cli-capability-4.md) and
[Workspace excerpt](stories/cli-capability-11.md) are the resulting **added blocks**,
not replacements for either capability's complete body. The paths identify these
excerpts; they do not recreate the deleted `stories/` tree.

Apply the blocks through the library's existing records and linked `Story text:`
definitions. Preserve current IDs, sibling content, shelves and contracts. Do not
import these excerpts as new stories or replace a whole story from them.

## Supervisor checklist, after the pull request merges

- [ ] Find the command-line story's existing capability 4, Arcs and increments,
  and capability 11, Workspace. Read their current text before applying the patch.
- [ ] Merge the arc-family addition into its description/as-built text; add the
  agent-link claims dependency and contract 4.6, retaining contracts 4.1–4.5.
- [ ] Merge the Workspace addition into its description/as-built text; add
  contracts 11.5 and 11.6, retaining contracts 11.1–11.4 and workspace setup details.
- [ ] Reconcile any existing statement that releasing is available only through
  the agent tools: the terminal now delegates to that same release function.
  Keep the noticeboard read only. Preserve the sibling ADR-number lane's edits.
- [ ] Read back or export the changed records and confirm the added blocks,
  dependencies and contracts persisted, and existing content and shelf entries
  survived. Do not mark these updates applied based only on this evidence patch.
- [ ] File the supervisor-owned decision record, then close increment
  `increment_cce7dfdccea4` on arc `arc_a365d0653ac9` with the merged pull request;
  confirm its claim has ended. The lane does not access either plan store.

## Evidence and curation

The CLI regression tests run the built command against an isolated test Postgres.
The pull request contains the observed red output, green checks and test-ratio
row. The only agent-link change exports its already-existing `closed` function;
`release` was already public. Neither claiming nor release rules are duplicated.
No other durable learning, friction item or owner redirection arose in this lane.
