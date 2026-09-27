# Pending library update — retire the one-time numbering commands

The laptop supervisor applies [changes.patch](changes.patch) after merge. This lane made no
live-library reads or writes, took no claims, and authored no decision or question record.

The baseline combines the read-only snapshot `2026-09-27T14-03-38-576Z.json` with the **new**
fields in the merged #135 [own-numbers patch](../../own-numbers/library-update/changes.patch).
Normalize CRLF to LF when comparing the library narrative. Reconcile every field against the
live library before applying; preserve sibling edits, IDs, unrelated fields and shelf links.
Paths name story/capability/record/field, not repository files.

This patch contains six field replacements and two contract retirements. A title deletion means
**retire that contract**, preserving its history; it does not mean writing an empty required title.
The snapshot does not contain the IDs of CLI contracts 6.9 and 6.10, added by #135. Locate those
records by capability and the titles below, then retire them too. No new contract is needed for
removing commands.

## Apply and read back

- [ ] Library capability 13 (`capability_78d6e026f902`, story `story_754e87e7d531`): replace its
  `description`, `definition_15f873f38fda.meaning`, and `contract_104cac07c8a3.title` (13.1).
- [ ] CLI capability 6 (`capability_562b2527ebca`, story `story_f9fb5136c28f`): replace its
  `description`, `definition_79d3c7b09427.meaning`, and `contract_693fdb277bb9.title` (6.6).
- [ ] Retire CLI 6.7 (`contract_976174fd2ce5`, `adr number`) and 6.8
  (`contract_ec99e8313114`, `adr renumber --from-full-record`) using the title deletion hunks.
- [ ] Locate and retire CLI 6.9 under `capability_562b2527ebca`: title starts
  `6.9 · ` followed by `` `adr set-floor --number <n>` is a one-time ADR-0662 move in storytree ``.
- [ ] Locate and retire CLI 6.10 under `capability_562b2527ebca`: title starts
  `6.10 · ` followed by `` `adr renumber --founding-books` is a one-time ADR-0662 move in storytree ``.
- [ ] Read back all six changed fields and confirm all four retired contracts have left the live
  capability. Verify unrelated fields and links survived.
- [ ] Keep library contracts 13.5 (`contract_a483129d2c61`), 13.6 (`contract_c759659246a2`),
  13.7 (`contract_99983b44394a`) and 13.8 (locate its post-snapshot ID) in place: the public
  library methods and their tests remain, as described below.
- [ ] Close `increment_c9935aa7f5fd` on `arc_23442c993f25` with the merged PR and outcome;
  record the library-method residue below. The supervisor owns closure and claims.

## File-fence residue

The CLI commands and their tests are retired. The library still publishes `numberDecision`,
`decisionNumberPlan`, `numberDecisionsFromFullRecord`, `setDecisionNumberFloor`, and
`numberFoundingDecisions`. Their wrappers in `packages/library/src/api/library.ts` still call
the implementations in `knowledge/`; the public exports and API test also reference them.
Those wrapper/export files are outside this lane's explicit fence. The lane requested a narrow
extension and proceeded only within the existing fence. Retaining these methods also retains
their tests and contracts; claiming complete library-API retirement would be inaccurate.

A follow-up to remove that public surface needs ownership of `packages/library/src/api/library.ts`,
`packages/library/src/api/library-api.test.ts`, and `packages/library/src/index.ts`, as well as the
knowledge files. Preserve automatic allocation from the stored floor and immutable ordinary
number edits. The old snapshot proof under `evidence/own-numbers/` also invokes these methods;
it is historical evidence, not a runtime caller or an ongoing product test.

No agent roles or decision records changed. Decision-log curation did not trigger; this story-text
patch carries the durable outcome. No separate friction or re-steer was filed.
