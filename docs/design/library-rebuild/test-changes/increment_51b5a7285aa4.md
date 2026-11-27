# Test changes: integration (increment_51b5a7285aa4)

Changes beyond re-pointed imports made at the swap, for the blind reviewer. No title or contract number changed.

1. Four tests imported `@storytree/library-rebuild`, the rebuild's working name; each now imports `@storytree/library`
   (the `.` export), one line each: `own-database.test.ts`, `writer.test.ts`, `projects/shared/ci-health.test.ts`,
   `projects/shared/cloud-session.test.ts`. Three more (`library-api`, `printable`, `public-reads`) were re-pointed
   the same way before them.
2. The TLS fixtures `testing/tls/*.crt` and `*.key` (eleven files), test code the swap's `git rm` dropped, are restored
   byte for byte from the snapshot 538759d3 at their old path, where `address-tls.test.ts` and
   `address-websocket.test.ts` look for them.
3. The store's behaviour suite (`storage/store/testing/behaviour-suite.ts`, test support the storage lane wrote from
   the contracts) gains assertions after the integration's test review found contracts 2.1, 2.3, 2.4, 2.5, 2.24 and
   2.25 not fully pinned: a save under a new type and version replaces the record, eight racing edits of different
   fields all survive, `edit` of a missing, prefix or retired id returns null, `get` of odd ids (a NUL byte among
   them) returns null, a read outside an `inOneWrite` work sees none of its writes before they commit, and a
   batch that replaces a record or is refused leaves history as the contract says. Two of them were red on the
   rebuild (2.24 on the in-memory store, 2.5 on Postgres) and the builder fixed the code.

Cold-rule note: the test reviewer of this increment read the old `transactions/behaviour-suite.ts` (old non-test
source by the brief's definition) from origin/main and the merge-base to compare assertion counts. Its hits were
handed on as file, line and contract number only; the test writer worked from `spec/02.txt`.

## The ledgers

| Domain | Ledger |
|---|---|
| Storage | `increment_23d599c571e6.md` |
| Opening a project | `increment_3df1aa3256fe.md` |
| Shared library | `increment_216cfd6f4f7e.md` |
| The plan | `increment_b87e6a0f2d97.md` |
| Health | `increment_e37477f2eb48.md` |
| Search | `increment_5f55f4ed06bc.md` |
| Arcs and increments | `increment_a2b03908794a.md` |
| Owner's inbox | `increment_d4e63b0ff102.md` |
| Notes | `increment_db0d57307978.md` |
| Decisions | `increment_46e203ea6642.md` |
| The librarian | `increment_e78e1099730d.md` |
| Front door | `increment_b683392d4147.md` |
| Commands | `increment_53ff8e067dfa.md` |
| Integration | this file |
