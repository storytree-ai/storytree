# Pending library update — CI's health account writes only health (ADR-0747)

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The library**
(`story_754e87e7d531`): capability **1 · Project libraries** (`capability_5e0362aae607`),
capability **8 · Cloud connection (GCP)** (`capability_a954e1eb16f6`) and the "as built" of
capability **5 · Health record** (`definition_0c86fce863cf`). It is an old → new text patch against
the read-only snapshot `2026-09-28T21-35-29-644Z.json`, read directly (the lane wrote to no store).
Record paths name library fields, not repository files. Read the current records first; keep ids,
other fields, shelf links and anything changed since the snapshot (the cihealth lane's patch also
appends to `definition_0c86fce863cf`; this line goes after it).

- [ ] Replace `capability_5e0362aae607` — `description`.
- [ ] Add contract 1.10 and 1.11 under `capability_5e0362aae607`.
- [ ] Add contract 8.4 under `capability_a954e1eb16f6`.
- [ ] Append the ADR-0747 "As built" line to `definition_0c86fce863cf` — `meaning`.
- [ ] Read back every edited record and the three new contracts.
- [ ] Close `increment_cc0dcbbd2600` on `arc_48a2bfc7fdbe` after merge, using `/tmp/cigrant-close.md`.
- [ ] Owner, after merge (`increment_bd23d64ff1e5`): `terraform apply`, open the project once with
      the updated app, then run the new `grants.sql` in Cloud SQL Studio on `storytree_storytree`
      as his own Google account (infra/ci-health/README.md step 2).

No decision or question is created by this patch (ADR-0747 already records the decision).
