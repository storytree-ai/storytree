/** Capability 1 · Portable user identity. */
import { IdentityVerificationError } from "./service.js";
import { IdentityConflictError, type StorytreeUser } from "./store.js";

/** Server-side fetch boundary; the authorized host supplies its initialized, private identity service. */
export function createIdentityHandler(service: { resolve(accessToken: string): Promise<StorytreeUser> }) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, body: unknown) => Response.json(body, {
      status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
    const url = new URL(request.url);
    if (url.pathname !== "/v1/identity" || url.search) return reply(404, { error: "Not found." });
    if (request.method !== "GET") return reply(405, { error: "Use GET." });
    const match = /^Bearer ([A-Za-z0-9._~-]{1,16384})$/.exec(request.headers.get("authorization") ?? "");
    if (!match?.[1]) return reply(401, { error: "Sign in again." });
    try {
      const user = await service.resolve(match[1]);
      // Provider subjects and the replaceable WorkOS pointer never cross this boundary.
      return reply(200, { id: user.id, email: user.firstVerifiedEmail });
    } catch (error) {
      if (error instanceof IdentityVerificationError) return reply(401, { error: "Sign in again." });
      if (error instanceof IdentityConflictError) return reply(409, { error: "This identity needs Storytree support before it can be linked." });
      return reply(503, { error: "Identity is temporarily unavailable. Try again later." });
    }
  };
}
