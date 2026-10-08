# Optional identity foundations

The server resolves a verified WorkOS session to a Storytree-owned UUID. It fetches the user and all linked social identities from WorkOS, then matches only normalized provider + provider subject. The first verified email is retained as contact information; it is never a lookup key. Google, GitHub and Microsoft are accepted. Conflicting established users are refused, never merged automatically.

```ts
import { createIdentityService } from "@storytree/identity";

const identity = createIdentityService({
  pool, // server-owned pg Pool in the identity database
  clientId,
  apiKey, // injected at runtime from Secret Manager, never in a desktop/CLI build
  issuer, // exact issuer from this environment's trusted discovery document
  audience: "storytree-identity", // configure this in the WorkOS JWT template
});
await identity.initialize();
const user = await identity.resolve(accessToken);
```

`initialize` creates the two tables in the pool's database/schema. Production database roles and deployment remain unconfigured. Mapping transactions serialize with a Postgres advisory lock; uniqueness is also enforced by the database. This suits the initial cohort; it is not a throughput claim.

The service pins the configured client's JWKS URL, checks RS256 signatures, issuer, audience, expiry, user and session claims, then fetches authoritative identity evidence using the server key. It does not treat a token's email or WorkOS subject as Storytree's durable identity. WorkOS performs its own credential linking; Storytree trusts that authenticated identity set and refuses a set spanning two existing Storytree users.

This package is not a deployed sign-in service. Its device-flow client, command handler, protected session store and HTTP boundary are ready for integration. The desktop SDK, public CLI registration, deployment and live staging acceptance remain on the identity increment. Hosted authentication methods must still be restricted to the three social providers: this identity resolver does not enforce which method minted an otherwise valid WorkOS session. Local JWT verification also does not establish immediate revocation; session lifecycle remains part of that pending work.

The configured issuer must come from trusted environment discovery at `https://api.workos.com/user_management/<clientId>/.well-known/openid-configuration`. AuthKit does not supply an audience by default; configure it before using this server boundary. Never discover a trust endpoint from an incoming token.

Primary references checked 2026-10-03: [identities API](https://workos.com/docs/reference/authkit/identity), [identity linking](https://workos.com/docs/authkit/identity-linking), [API token verification](https://workos.com/blog/verify-workos-access-tokens-in-your-own-api), [JWT templates](https://workos.com/docs/authkit/jwt-templates), [OIDC discovery](https://workos.com/docs/cli/emulate#oidc-discovery).

See [validation evidence](evidence/README.md) for the distinction between local protocol proof and the blocked live staging journey.


## Public client and command handler

Import `@storytree/identity/client` or `@storytree/identity/command` in clients, never the server entry point. The command-line story will parse `sign-in`, status and sign-out and delegate to `identityCommand`. Its registration is not shipped by this foundation.

```ts
import { identityCommand } from "@storytree/identity/command";

const answer = await identityCommand("sign-in", {
  clientId, // public, configured for this environment
  identityUrl, // explicitly configured HTTPS /v1/identity endpoint
  directory, // identity-owned subdirectory beneath the user's private Storytree home
  out: text => process.stdout.write(text + "\n"),
  signal, // abort on the CLI's cancellation signal
});
process.stdout.write(answer + "\n");
```

The device flow shows the user code and verification URL, waits at least the server's interval, adds five seconds after `slow_down` per RFC 8628, and stops on denial, expiry or cancellation. It reports a user only after the configured identity server verifies the access token. Errors suppress upstream text. Neither device codes nor tokens enter command output.

Status exchanges the saved refresh token, replaces it after rotation, and asks the identity server again. Revoked sessions are discarded; transient failures do not claim a signed-in user and retain the latest rotated refresh token. Local sign-out deletes the saved session; it does not claim to revoke the browser's hosted WorkOS session. Opening a client makes no network request. A signed-out status makes none either. Installation, first run and the agent link remain account-free.

`withSessionStore` serializes the complete command across processes. On Linux/macOS the directory must belong to the current user with no group/other permissions, and the session file is mode 0600. These platforms protect the file with permissions, not encryption. On Windows the payload uses CurrentUser DPAPI through PowerShell; there is no plaintext fallback. Only the refresh token and its environment binding are persisted. Access tokens stay in memory. The frame must place the directory under the user's trusted private home.

An interrupted process may leave `command-lock/pid`. Inspect that PID before removing its lock directory; never remove a live command's lock. Sign-in is bounded to the provider's expiry (at most one hour). A competing status/sign-out is refused while it is running, so a late sign-in cannot recreate a session after a successful sign-out.

## HTTP and feedback integration

`createIdentityHandler(initializedService)` implements `GET /v1/identity` as a standard Request/Response handler. Authorization is bearer-only; query tokens and other routes are refused. It returns only `{id, email}` with `Cache-Control: no-store`, never provider subjects or the WorkOS pointer. The authorized hosting layer must provide HTTPS, a server-owned pool and runtime secrets. This change creates no listener, database, service or cloud resource.

The app-setup feedback surface accepts an optional `feedbackIdentity` bridge with `status`, `signIn` and `signOut`. It consults identity only on the feedback page. Adding an account is a separate explicit action which inserts the verified email and id into the ordinary editable message. Copy and the GitHub draft use exactly that message. Feedback continues to work without it.

## Desktop sign-in (`@storytree/identity/desktop`)

The desktop's main process composes the official `@workos/authkit-electron` SDK (system-browser PKCE, protected storage, refresh) and hands its session manager to `callbackSession`, which completes the `storytree-auth://callback` deep link. `createFeedbackIdentity({ clientId, session })` answers the bridge. With no identity server yet (the owner's choice D on question_10f89f734427), it checks the access token itself: RS256 against `https://api.workos.com/sso/jwks/<clientId>`, audience `storytree-identity` (the JWT template's), a `user_` subject, and the client if the token names one. The email is the one the same sign-in's code exchange returned to the SDK, used only when that user is the token's subject and WorkOS marks the email verified; so the JWT template needs no email claim. The id is therefore the WorkOS user id until a server gives users portable Storytree ids. A token or account that does not verify signs the desktop out; keys that cannot be fetched keep the session. Only `{id, email}` leaves the main process. A build offers sign-in only when it stamps `STORYTREE_WORKOS_CLIENT_ID`; no identity endpoint is needed.

Protocol references checked 2026-10-06: [WorkOS CLI Auth](https://workos.com/docs/authkit/cli-auth), [RFC 8628 polling and slow-down](https://www.rfc-editor.org/rfc/rfc8628.html#section-3.5), [official Electron SDK](https://github.com/workos/authkit-electron). Local proofs are described in [evidence](evidence/README.md); they do not substitute for live social sign-in.
