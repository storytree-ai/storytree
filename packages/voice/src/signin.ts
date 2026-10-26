/**
 * Capability 1 · The address and its guards (contracts 1.15-1.19): the owner's sign-in. A signed tool (every write, once
 * there are any) runs only for a token the sign-in service issued for this connector's exact address, unexpired, whose
 * user is the owner; reads never look at a token, so a sign-in that misbehaves cannot take them down. With no sign-in
 * service configured no signed tool is registered at all.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SignInConfig } from "./config.js";

/** The tools that need the owner's sign-in. */
export const SIGNED_TOOL_NAMES: readonly string[] = ["who_am_i"];

/** Who a verified token says is calling. */
export interface SignedCaller {
  readonly user: string;
  readonly expires: Date;
}

/** Why a signed call is refused: 401 asks claude.ai to sign in (again), 403 is someone else, 503 is keys out of reach. */
export class SignInRefusal extends Error {
  constructor(readonly status: 401 | 403 | 503, readonly reason: string, readonly tokenGiven: boolean) {
    super(reason);
  }
}

// jose's codes for a token that can never verify, as opposed to keys that could not be fetched.
const REFUSED_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JWKS_MULTIPLE_MATCHING_KEYS", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED",
]);

export interface SignIn {
  /** The metadata claude.ai reads to find the sign-in service (RFC 9728). */
  readonly metadata: string;
  /** The WWW-Authenticate challenge for a 401. */
  challenge(refusal: SignInRefusal): string;
  /** The caller an Authorization header proves, or a SignInRefusal. */
  verify(authorization: string | undefined): Promise<SignedCaller>;
}

export function signIn(config: SignInConfig): SignIn {
  const keys = createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 10_000 });
  return {
    metadata: JSON.stringify({ resource: config.resource, authorization_servers: [config.issuer], bearer_methods_supported: ["header"] }),
    challenge: (refusal) =>
      [`Bearer resource_metadata="${config.metadataUrl}"`, ...(refusal.tokenGiven ? ['error="invalid_token"'] : [])].join(", "),
    async verify(authorization) {
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
      if (!match) throw new SignInRefusal(401, authorization ? "malformed" : "none", authorization !== undefined);
      let payload;
      try {
        ({ payload } = await jwtVerify(match[1]!, keys, {
          issuer: config.issuer,
          audience: config.resource,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "sub"],
        }));
      } catch (error) {
        const code = String((error as { code?: unknown }).code);
        if (REFUSED_CODES.has(code)) throw new SignInRefusal(401, code, true);
        throw new SignInRefusal(503, "keys", true);
      }
      if (payload.sub !== config.owner) throw new SignInRefusal(403, "not-owner", true);
      return { user: payload.sub, expires: new Date(payload.exp! * 1000) };
    },
  };
}

/** The signed tools, registered only when sign-in is configured; the door has verified the caller before any runs. */
export function registerSignedTools(server: McpServer, caller: () => SignedCaller | undefined): void {
  server.registerTool(
    "who_am_i",
    {
      title: "Who am I signed in as",
      description:
        "Say whether this call carries the owner's sign-in, and when it runs out. Needs the owner's sign-in: the first call asks for it. " +
        "Use it to check sign-in works before a write.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const signed = caller();
      if (signed === undefined) return { content: [{ type: "text", text: "Not signed in." }], isError: true };
      return { content: [{ type: "text", text: `Signed in as the owner (${signed.user}); the sign-in runs out at ${signed.expires.toISOString()}.` }] };
    },
  );
}
