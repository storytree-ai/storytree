# Portable identity proof — 2026-10-03

Contracts 1.1–1.5 of Identity's portable user capability are exercised through the public service boundary in `src/identity.test.ts`.

- Real ephemeral Postgres, isolated schema per test; signed RSA JWTs; a real loopback HTTP stand-in serving WorkOS-shaped JWKS, user and identity responses.
- First sign-in persists an independent UUID, first verified email, replaceable WorkOS pointer and all three supported provider identities. Reopening keeps it.
- Changing email and WorkOS pointer preserves the provider subject's ID. An unrelated subject with the same email, or the same subject string at a different provider, stays separate.
- Newly linked identities join the existing user atomically. Evidence spanning two existing users leaves the database unchanged.
- Eight concurrent resolutions return one user and one identity row.
- Invalid signature, issuer, audience, absent audience/subject/session, expiry, not-before and wrong client ID fail before user API requests. Unverified/mismatched users, unsupported identity types/providers, empty subjects and upstream failures leave no users behind. Database acquisition errors are sanitized too.

Red witnessed: the initial named-file run failed because the identity module did not exist. After implementation all five tests passed. Review then exposed an unsanitized database-pool acquisition error: the new assertion failed with `Cannot use a pool after calling end on the pool`; the service boundary fix made it pass.

Run: `pnpm run test packages/identity/src/identity.test.ts`. Full repository verification uses `pnpm gate`; its actual result is in the pull request and session report.

## Live staging: NOT RUN

The existing WorkOS staging environment is authorized. This Mint process could not obtain its existing credentials:

- `gcloud secrets versions access latest --secret WORKOS_API_KEY --project storytree-498613` failed because gcloud has no selected login account.
- Existing ADC credentials belong to `storytree-mint@storytree-498613.iam.gserviceaccount.com`; obtaining its Google token succeeded.
- Secret Manager REST reads of both `WORKOS_API_KEY` and `workos_clientid` returned HTTP 403, permission `secretmanager.versions.access` denied. Neither secret value was printed, saved or committed.

The predecessor's successful staging check remains historical evidence from another execution identity. It does not prove this Mint lane can run staging. No provider account, production configuration, cloud deployment or spend was made. The owning arc carries one complete access/setup question; the implementation increment remains open for sign-in and live acceptance.
