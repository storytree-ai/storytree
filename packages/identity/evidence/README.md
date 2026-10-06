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

## Historical live-staging check — 2026-10-03: NOT RUN

The existing WorkOS staging environment is authorized. This Mint process could not obtain its existing credentials:

- `gcloud secrets versions access latest --secret WORKOS_API_KEY --project storytree-498613` failed because gcloud has no selected login account.
- Existing ADC credentials belong to `storytree-mint@storytree-498613.iam.gserviceaccount.com`; obtaining its Google token succeeded.
- Secret Manager REST reads of both `WORKOS_API_KEY` and `workos_clientid` returned HTTP 403, permission `secretmanager.versions.access` denied. Neither secret value was printed, saved or committed.

The predecessor's successful staging check remains historical evidence from another execution identity. It does not prove this Mint lane can run staging. No provider account, production configuration, cloud deployment or spend was made. The owning arc carries one complete access/setup question; the implementation increment remains open for sign-in and live acceptance.


## Device flow, persistence and HTTP boundary — 2026-10-06

The client and session-store tests first failed with missing modules, the HTTP test with its missing public export, and the feedback tests with the missing optional identity behavior. Those failures were witnessed before implementation. The resulting local proofs cover:

- Device authorization prompt privacy, pending/slow-down intervals, denial, expiry, cancellation, malformed replies, HTTPS endpoint pinning and refusal to claim a user before server verification.
- Reopened status, refresh rotation, revocation, temporary failure preservation, local sign-out and captured command output without tokens.
- Real private filesystem persistence, a subsequent Node process reading the same session, cross-command exclusion, environment binding, permissions and symlink refusal on POSIX. The same test exercises real DPAPI on Windows CI; Linux does not prove that platform path.
- A real loopback HTTP request into the identity handler, real signed JWT validation against WorkOS-shaped HTTP responses, and an isolated ephemeral Postgres schema. Only the portable ID and first verified email are returned. Refused HTTP requests do not mutate identity rows; server errors do not expose secrets.
- Feedback's optional identity bridge, no first-run identity request, explicit insertion into the editable message, removal before sharing, and normal feedback after sign-in failure. [Chromium captures](../../app-setup/evidence/identity/README.md) use a fixture account and submit nothing.

Run the behavior tests with `pnpm run test packages/identity/src/identity.test.ts packages/identity/src/client.test.ts packages/identity/src/session-store.test.ts packages/identity/src/command.test.ts packages/app-setup/src/view/mount.test.ts`. The PR and lane report carry the final gate table and three-platform CI results.

## Read-only staging check — 2026-10-06, about 02:11 UTC

Both Secret Manager values were read successfully using the Mint ADC identity, kept in process memory and never printed or saved. The WorkOS key is staging. Trusted client discovery returned 200 with the expected client-specific issuer.

- Redirect list: HTTP 200, no further page, and `storytree-auth://callback` absent.
- JWT template: HTTP 404 with the template-not-found message. Required audience `storytree-identity` is not configured by a template.
- Provider configuration: unverified. A fresh Chromium browser opened the hosted authorization page using an already registered redirect solely for inspection; it displayed “Something went wrong” without provider controls. No provider was clicked, no account signed in, no email was sent, and no settings were changed. This does not prove providers are on or off.
- Hosting: the increment says no identity backend exists; repository infra describes CI-health and website publishing identities, not an identity runtime. Mint's read-only Cloud Run list returned 403, so the cloud inventory could not be verified. No existing authorized runtime was identified. No cloud resource or spend was created, and the shared Cloud SQL instance was not changed.

Live social sign-in, returning-user, denied/expired, restart/sign-out, feedback and installed desktop deep-link journeys remain NOT RUN. Settings and hosting are owner gates recorded on the identity arc. Core CLI/front-door and desktop/preload/dependency wiring are also unfinished and separately parked; this is not a shipped end-to-end sign-in claim.
