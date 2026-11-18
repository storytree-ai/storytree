// Capability 6 · Social sign-in and session
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { SignedInUser } from "./client.js";

export interface WorkosAccount { readonly id: string; readonly email: string; readonly emailVerified: boolean }

export const IDENTITY_AUDIENCE = "storytree-identity";

export class TokenRefused extends Error {}
export class KeysUnavailable extends Error {}

const REFUSED_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED",
]);

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
