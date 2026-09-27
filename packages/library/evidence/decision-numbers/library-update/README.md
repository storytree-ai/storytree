# Bulk N1 update for the laptop supervisor

Apply after this lane's PR merges. These are proposed edits to existing capability and narrative
records, not an import source. No live record was written by this lane.

[bulk-changes.patch](bulk-changes.patch) gives the incremental changes after PR #130's target
text, plus an as-built addition based on the supplied read-only snapshot. The older
[changes.patch](changes.patch) is preserved as PR #130 evidence. If that earlier update has
already been applied, do not apply it again. Read the live fields first and preserve sibling
edits, IDs, links and shelves. If PR #130's capability changes were never applied, reconcile
the capability and contract content from the target files below; the older patch's decision
amendment remains historical only.

- [ ] Library story `story_754e87e7d531`, capability 13 `capability_78d6e026f902`: update the
  repair collision rule in the description and contract 13.5 (or its live number) to
  **any record ever held**, and add the bulk preview/apply contract 13.7
  (use the next free contract number if occupied). [Target text](library-capability-13.md).
- [ ] Existing narrative definition `definition_15f873f38fda` (`Story text: stories/library.md
  ## 13 · Decision log`): append the new as-built paragraph. The patch is against the snapshot's
  meaning; preserve any live corrections. [Text](library-capability-13-as-built.md).
- [ ] Command-line story `story_f9fb5136c28f`, capability 6 `capability_562b2527ebca`: extend
  the repair contract with the bulk command, explicit apply, output/refusals, and safe reruns.
  [Target text](command-line-capability-6.md).
- [ ] In the storytree checkout on the laptop, with the merged app running, preview:
  `pnpm storytree adr renumber --from-full-record --dry-run`.
  Expect 29 ready and 0 refused on the supplied snapshot state. If numbers have already been
  repaired, matching decisions are omitted; compare IDs with the evidence and current history.
- [ ] Review each proposal, then apply: `pnpm storytree adr renumber --from-full-record --apply`.
  Any refusal exits nonzero; independent eligible rows may still have been written.
- [ ] Preview again: `pnpm storytree adr renumber --from-full-record --dry-run`.
  Confirm 0 ready, 0 refused, preserved IDs/text/status/links/history, and 53 unchanged founding
  decisions. Legacy records receive the ordinary accepted-status schema upgrade when written.
- [ ] Read back narrative/capability edits. Record the owner's decision and close
  `increment_4c869f0f71a1` on `arc_23442c993f25` with the merged PR, as the supervisor owns.

Founding-books mode remains a follow-up; this command cannot authorize those 53 records.
No question or decision text was newly authored or changed by this lane. The decision amendment
inside the older PR #130 patch is historical evidence, not a new instruction from this lane.
