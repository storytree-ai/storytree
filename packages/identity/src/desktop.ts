/** Capability 2 · Social sign-in and session. */
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { SignedInUser } from "./client.js";

/** The user a sign-in returned, as WorkOS's code exchange gave it to the SDK's session. */
export interface DesktopAccount { readonly id: string; readonly email: string; readonly emailVerified: boolean }

/**
 * What the desktop's main process gets from the official WorkOS desktop SDK, which owns system-browser
 * PKCE, the storytree-auth deep link, refresh and protected token storage. Tokens stay on this side.
 */
export interface DesktopSession {
  /** False when the platform cannot encrypt saved tokens (Electron's safeStorage unavailable). */
  storageProtected(): boolean | Promise<boolean>;
  /** The current access token, refreshed by the SDK, with the user its sign-in returned; undefined when signed out. */
  current(): Promise<{ readonly accessToken: string; readonly user: DesktopAccount } | undefined>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export interface DesktopIdentityConfiguration {
  /** The public WorkOS client whose published keys sign this app's access tokens. */
  readonly clientId: string;
  readonly session: DesktopSession;
  readonly fetch?: typeof fetch;
}

/** The audience WorkOS's JWT template stamps on Storytree's access tokens. */
export const IDENTITY_AUDIENCE = "storytree-identity";

class Refused extends Error {}
// jose's codes for a token that can never verify, as opposed to keys that could not be fetched.
const REFUSED_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED",
]);

/**
 * The feedback bridge's account calls: optional, only id and email out. With no identity server yet (question
 * D), the desktop checks WorkOS's access token itself against the client's published keys, and takes the email
 * from the user that same sign-in returned, only when it is that token's subject and its email is verified.
 */
export function createFeedbackIdentity(config: DesktopIdentityConfiguration) {
  const { session } = config;
  // Neither the key URL nor the audience comes from the token.
  const keys = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${config.clientId}`), {
    ...(config.fetch ? { [customFetch]: config.fetch } : {}), timeoutDuration: 10_000,
  });
  const verify = async (): Promise<SignedInUser | null> => {
    const signedIn = await session.current();
    if (signedIn === undefined) return null;
    try {
      const { payload } = await jwtVerify(signedIn.accessToken, keys, {
        audience: IDENTITY_AUDIENCE, algorithms: ["RS256"], requiredClaims: ["sub", "sid", "iat", "exp"],
      });
      const { user } = signedIn;
      if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9_-]+$/.test(payload.sub) || payload.sub !== user.id
        || (payload.client_id !== undefined && payload.client_id !== config.clientId)
        || user.emailVerified !== true || typeof user.email !== "string" || user.email.trim() === "") {
        throw new Refused();
      }
      return { id: user.id, email: user.email };
    } catch (error) {
      if (error instanceof Refused || REFUSED_CODES.has(String((error as { code?: unknown }).code))) {
        await session.signOut();
        return null;
      }
      // The keys could not be fetched: keep the session for the next try.
      throw new Error("Sign-in is temporarily unavailable. Try again later; Storytree still works without an account.");
    }
  };
  return {
    /** Fails closed: without protected storage no saved token is read. */
    status: async (): Promise<SignedInUser | null> => (await session.storageProtected()) ? verify() : null,
    signIn: async (): Promise<SignedInUser> => {
      if (!(await session.storageProtected())) {
        throw new Error("This computer cannot protect a saved sign-in, so Storytree will not sign in here. It still works without an account.");
      }
      await session.signIn();
      const user = await verify();
      if (!user) throw new Error("Your sign-in could not be verified. Sign in again.");
      return user;
    },
    signOut: (): Promise<void> => session.signOut(),
  };
}

/**
 * Capability 2 · Social sign-in and session, contract 2.5: the desktop's sign-in through WorkOS's official Electron SDK.
 * Offered only when a build carries a public WorkOS client ID; otherwise there is no sign-in at all. Sign-in goes through the system browser and returns on the storytree-auth://callback deep
 * link, which callbackSession completes. Every token stays in the main process with the SDK's session manager.
 */

/** The deep link a sign-in returns on, registered with the OS by the packaged app. */
export const AUTH_CALLBACK = "storytree-auth://callback";
export const AUTH_SCHEME = "storytree-auth";

/** How long a sign-in waits for the browser to come back before it is given up. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export interface FeedbackIdentityConfig {
  readonly clientId: string;
}

/** The build's public sign-in settings, or undefined (no sign-in offered) unless its client ID is present and well formed. */
export function feedbackIdentityConfig(clientId: string | undefined): FeedbackIdentityConfig | undefined {
  if (clientId === undefined || !/^client_[A-Za-z0-9]+$/.test(clientId)) return undefined;
  return { clientId };
}

/** The sign-in callbacks among a start's arguments (a Windows or Linux deep link arrives as one). */
export function callbackUrls(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.toLowerCase().startsWith(`${AUTH_SCHEME}://`));
}

/** The part of the SDK's main-process session manager this module drives. */
export interface SignInEngine {
  beginSignIn(): Promise<void>;
  completeCallback(code: string, state: string | undefined): Promise<unknown>;
  /** The SDK's validated, refreshed session: its user and access token, or no user when signed out. */
  getUser(): Promise<{ user: null } | { user: DesktopAccount; accessToken: string }>;
  signOut(): Promise<unknown>;
}

export interface CallbackSession extends DesktopSession {
  storageProtected(): boolean;
  /** Complete (or refuse) the sign-in a callback deep link carries; a link that is not a callback is ignored. */
  callback(url: string): Promise<void>;
}

/**
 * Adapt the SDK's session manager to the identity package's DesktopSession. signIn opens the system browser and
 * settles only when the callback arrives: completed, refused by the provider, failed in exchange, or timed out.
 * A callback with no sign-in waiting (one that started the app) is still completed, so its session is kept.
 */
export function callbackSession(
  engine: SignInEngine,
  storageProtected: () => boolean,
  timeoutMs: number = SIGN_IN_TIMEOUT_MS,
): CallbackSession {
  let pending: { promise: Promise<void>; settle(error?: Error): void } | undefined;

  const settle = (error?: Error): void => {
    const waiting = pending;
    pending = undefined;
    waiting?.settle(error);
  };

  return {
    storageProtected,
    current: async () => {
      const auth = await engine.getUser();
      return auth.user === null ? undefined : { accessToken: auth.accessToken, user: auth.user };
    },
    signOut: async () => {
      settle(new Error("Signed out before the sign-in finished"));
      await engine.signOut();
    },
    signIn: async () => {
      if (pending !== undefined) return pending.promise;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finish!: (error?: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        finish = (error) => {
          clearTimeout(timer);
          if (error === undefined) resolve();
          else reject(error);
        };
      });
      const waiting = { promise, settle: finish };
      pending = waiting;
      timer = setTimeout(() => { if (pending === waiting) settle(new Error("The sign-in did not come back from the browser in time")); }, timeoutMs);
      try {
        await engine.beginSignIn();
      } catch (error) {
        if (pending === waiting) settle(error instanceof Error ? error : new Error(String(error)));
      }
      return promise;
    },
    callback: async (url) => {
      let params: URLSearchParams;
      try {
        const parsed = new URL(url);
        if (`${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}` !== AUTH_CALLBACK) return;
        params = parsed.searchParams;
      } catch {
        return;
      }
      const refused = params.get("error");
      if (refused !== null) {
        settle(new Error(`The sign-in was refused: ${params.get("error_description") ?? refused}`));
        return;
      }
      const code = params.get("code");
      if (code === null) return;
      try {
        await engine.completeCallback(code, params.get("state") ?? undefined);
        settle();
      } catch (error) {
        settle(new Error(`The sign-in could not be completed: ${error instanceof Error ? error.message : String(error)}`));
      }
    },
  };
}
