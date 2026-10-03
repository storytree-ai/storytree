# Identity server foundation

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

This package is a server foundation, not a deployed sign-in service. Desktop PKCE, CLI device authorization, protected token storage, reviewed feedback attribution and live staging acceptance remain on the identity increment. Hosted authentication methods must still be restricted to the three social providers: this identity resolver does not enforce which method minted an otherwise valid WorkOS session. Local JWT verification also does not establish immediate revocation; session lifecycle remains part of that pending work.

The configured issuer must come from trusted environment discovery at `https://api.workos.com/user_management/<clientId>/.well-known/openid-configuration`. AuthKit does not supply an audience by default; configure it before using this server boundary. Never discover a trust endpoint from an incoming token.

Primary references checked 2026-10-03: [identities API](https://workos.com/docs/reference/authkit/identity), [identity linking](https://workos.com/docs/authkit/identity-linking), [API token verification](https://workos.com/blog/verify-workos-access-tokens-in-your-own-api), [JWT templates](https://workos.com/docs/authkit/jwt-templates), [OIDC discovery](https://workos.com/docs/cli/emulate#oidc-discovery).

See [validation evidence](evidence/README.md) for the distinction between local protocol proof and the blocked live staging journey.
