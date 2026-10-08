/** Capability 2 · Social sign-in and session. */
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { SignedInUser } from "./client.js";

/** The user a WorkOS sign-in or refresh returned beside its access token. */
export interface WorkosAccount { readonly id: string; readonly email: string; readonly emailVerified: boolean }

/** The audience WorkOS's JWT template stamps on Storytree's access tokens. */
export const IDENTITY_AUDIENCE = "storytree-identity";

/** The token or its user can never verify: the session is to be dropped. */
export class TokenRefused extends Error {}
/** The client's published keys could not be fetched: the session is kept for the next try. */
export class KeysUnavailable extends Error {}

// jose's codes for a token that can never verify, as opposed to keys that could not be fetched.
const REFUSED_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED",
]);

/**
 * With no identity server yet (question D), a sign-in checks WorkOS's access token itself against the client's
 * published keys, and takes the email from the user that same exchange returned, only when it is that token's
 * subject and its email is verified. Neither the key URL nor the audience comes from the token.
 */
export function workosTokenVerifier(clientId: string, request?: typeof fetch) {
  const keys = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`), {
    ...(request ? { [customFetch]: request } : {}), timeoutDuration: 10_000,
  });
  return async (accessToken: string, user: WorkosAccount): Promise<SignedInUser> => {
    try {
      const { payload } = await jwtVerify(accessToken, keys, {
        audience: IDENTITY_AUDIENCE, algorithms: ["RS256"], requiredClaims: ["sub", "sid", "iat", "exp"],
      });
      if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(payload.sub) || payload.sub !== user.id
        || (payload.client_id !== undefined && payload.client_id !== clientId)
        || user.emailVerified !== true || typeof user.email !== "string" || !/^[^\x00-\x20\x7f@]+@[^\x00-\x20\x7f@]+$/.test(user.email)) {
        throw new TokenRefused();
      }
      return { id: user.id, email: user.email };
    } catch (error) {
      if (error instanceof TokenRefused || REFUSED_CODES.has(String((error as { code?: unknown }).code))) throw new TokenRefused();
      throw new KeysUnavailable();
    }
  };
}
