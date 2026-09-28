# Pending library update — CI is the one writer of own verified health

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The app**
(`story_a93c6fb1a257`), capability **4 · Updates** (`capability_6a0c1b26f586`). It is an old → new
text patch against the supplied `2026-09-28T21-35-29-644Z.json` snapshot, read straight from the
file (read-only). The lane has not written to either live store. Record paths identify library
fields, not repository files. Read the current records first; keep IDs, other fields, shelf links
and any change made since the snapshot.

- [ ] Replace `contract_b872bebaa9b8` — `description` (4.3): adds the Cloud SQL sentence.
- [ ] Append the "As built" item to `definition_35a9bf6d841b` — `meaning`.
- [ ] If the cihealth lane's note ("Since `increment_8137094ea0aa`, `pnpm check:own-health` records
      into the library the `library` setting names. With the setting on Cloud SQL, 4.3's check
      writes there …", `scripts/evidence/cihealth/library-update/`) was already appended to that
      definition, remove its last two sentences about 4.3 writing Cloud SQL beside CI: they are no
      longer true. If it was not yet applied, apply only its first sentence to this record.
- [ ] That cihealth checklist's open item ("Keep both, or retire 4.3's recording") is answered by
      this landing: 4.3 no longer records into Cloud SQL. Tick it there.
- [ ] Read back both records.
- [ ] Close `increment_10dc2a4c5f78` on `arc_48a2bfc7fdbe` using `/tmp/onewriter-close.md`.

No new contract: the behaviour is a clause of 4.3. No decision or question is created by this patch.
