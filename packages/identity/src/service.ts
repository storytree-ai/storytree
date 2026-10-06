/** Capability 1 · Portable user identity. */
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { Pool } from "pg";
import { IdentityConflictError, initialize, remember, type ProviderIdentity, type StorytreeUser } from "./store.js";

export interface IdentityConfiguration {
  /** A server-owned pool in the identity database, never an end user's library connection. */
  readonly pool: Pool;
  readonly clientId: string;
  /** Pin the issuer obtained from this environment's trusted discovery document. */
  readonly issuer: string;
  /** The audience configured in WorkOS's JWT template for the Storytree identity API. */
  readonly audience: string;
  readonly apiKey: string;
  /** Transport seam; production uses the platform fetch. */
  readonly fetch?: typeof fetch;
}

export class IdentityVerificationError extends Error {
  constructor() { super("Your sign-in could not be verified. Sign in again or contact Storytree support."); }
}

/** WorkOS proves its user; only the authoritative provider subjects select a Storytree user. */
export function createIdentityService(config: IdentityConfiguration): {
  initialize(): Promise<void>;
  resolve(accessToken: string): Promise<StorytreeUser>;
} {
  if (!/^client_[A-Za-z0-9_-]+$/.test(config.clientId) || !nonempty(config.apiKey)
    || !nonempty(config.audience) || !nonempty(config.issuer) || new URL(config.issuer).protocol !== "https:") {
    throw new Error("Identity needs a WorkOS client, server API key, trusted HTTPS issuer and API audience.");
  }
  const request = config.fetch ?? fetch;
  // Neither the issuer nor the key URL comes from the incoming token.
  const keys = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${config.clientId}`), {
    [customFetch]: request, timeoutDuration: 10_000,
  });
  const get = async (path: string): Promise<unknown> => {
    const response = await request(`https://api.workos.com/user_management/${path}`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new IdentityVerificationError();
    return response.json();
  };
  return {
    initialize: () => initialize(config.pool),
    resolve: async (accessToken) => {
      let workosUserId: string;
      let email: string;
      let identities: ProviderIdentity[];
      try {
        const { payload } = await jwtVerify(accessToken, keys, {
          issuer: config.issuer, audience: config.audience, algorithms: ["RS256"],
          requiredClaims: ["sub", "sid", "iat", "exp"],
        });
        if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(payload.sub)
          || !nonempty(payload.sid) || (payload.client_id !== undefined && payload.client_id !== config.clientId)) {
          throw new IdentityVerificationError();
        }
        workosUserId = payload.sub;
        const user = object(await get(`users/${encodeURIComponent(workosUserId)}`));
        if (user.id !== workosUserId || user.email_verified !== true || !nonempty(user.email)) {
          throw new IdentityVerificationError();
        }
        email = user.email;
        identities = socialIdentities(await get(`users/${encodeURIComponent(workosUserId)}/identities`));
      } catch {
        // No upstream response, JWT, email or API key crosses the error boundary.
        throw new IdentityVerificationError();
      }
      try {
        return await remember(config.pool, { workosUserId, email, identities });
      } catch (error) {
        if (error instanceof IdentityConflictError) throw error;
        throw new Error("Storytree could not save your identity. Try again later.");
      }
    },
  };
}

function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IdentityVerificationError();
  return value as Record<string, unknown>;
}
function socialIdentities(value: unknown): ProviderIdentity[] {
  if (!Array.isArray(value) || value.length === 0) throw new IdentityVerificationError();
  const identities: ProviderIdentity[] = [];
  for (const item of value) {
    const identity = object(item);
    const provider = identity.provider === "GoogleOAuth" ? "google"
      : identity.provider === "GithubOAuth" || identity.provider === "GitHubOAuth" ? "github"
        : identity.provider === "MicrosoftOAuth" ? "microsoft" : undefined;
    if (identity.type !== "OAuth" || provider === undefined || !nonempty(identity.idp_id)) throw new IdentityVerificationError();
    if (!identities.some((saved) => saved.provider === provider && saved.subject === identity.idp_id)) {
      identities.push({ provider, subject: identity.idp_id });
    }
  }
  return identities;
}
