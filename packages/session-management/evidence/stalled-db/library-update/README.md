# Supervisor checklist

The lane could not access the live library. `changes.patch` is based on the read-only
snapshot `2026-09-27T14-03-38-576Z.json`; no live records, claims, decisions or questions
were read or written. Each `+++ new/<story>/<capability>/<record>/<field>` identifies
a field to replace, or a contract to add.

- [ ] Compare the old text to the live records; preserve concurrent changes.
- [ ] Amend agent-tools contract `contract_4f7c81325063` under `capability_11fe600afeda`.
- [ ] Update as-built definition `definition_6d3723ad9283` on that capability's shelf.
- [ ] Add library contract 1.9 under `capability_5e0362aae607` (1.9 is free in the snapshot).
- [ ] Read back the updated fields and new contract to verify persistence.
- [ ] After the PR merges, close `increment_6236a0e8c487` on `arc_cfc7db517fae`
  with its outcome and PR, and release the supervisor-held claim.

No decision or guidance changes were needed; decision-log curation did not fire.
