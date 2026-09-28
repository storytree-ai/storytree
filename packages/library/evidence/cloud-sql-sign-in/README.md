# Cloud SQL sign-in within its bound · contract 8.1

Increment `increment_5e6ac23db68f` (arc `arc_238ac88fdb14`, ADR-0734).

Contract 8.1's live proof (`src/transactions/cloud-sql.test.ts`) against the real instance
`storytree-498613:australia-southeast1:storytree-pg`, as `hua.mick@gmail.com`, on the owner's
Windows laptop, 2026-09-28.

- [red.txt](red.txt): every test refused with `problem: 'timeout'`. Measured: the connector's sign-in
  took ~40 s. Of that, ~30 s was Google's auth library running `gcloud config config-helper` to
  find a project id; the Admin API lookup and the database connection took under a second each.
- The fix: the connector is handed a `GoogleAuth` told the instance's own project (the first part
  of its connection name), so nothing asks `gcloud`. `google-auth-library` is now a direct
  dependency at the same version the connector resolves (10.9.1), so the connector's own
  `instanceof GoogleAuth` check accepts it.
- [green.txt](green.txt): the whole 8.1 suite passes, 9 of 9, sign-in in ~2 s.

Checked on the way (the increment's early checks): the instance is Postgres 16.14, the embedded
server is 17; a project snapshot is plain rows (capability 1, 1.6–1.8), so the major-version gap does
not reach it. No 0.3 feature needs an extension (ADR-0733 D3 keeps vectors as bytea, no pgvector).
The IAM user may create project databases through the granted role `storytree_creator`, so no
infra grant was needed for this account.
