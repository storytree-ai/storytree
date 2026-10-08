/** Capability 2 · Social sign-in and session. */
import { isRefused, verifiedUser, type SignedInUser } from "./client.js";

/**
 * What the desktop's main process gets from the official WorkOS desktop SDK, which owns system-browser
 * PKCE, the storytree-auth deep link, refresh and protected token storage. Tokens stay on this side.
 */
export interface DesktopSession {
  /** False when the platform cannot encrypt saved tokens (Electron's safeStorage unavailable). */
  storageProtected(): boolean | Promise<boolean>;
  /** A current access token, refreshed by the SDK, or undefined when signed out. */
  accessToken(): Promise<string | undefined>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export interface DesktopIdentityConfiguration {
  /** Full, explicitly configured server endpoint; never learned from an access token. */
  readonly identityUrl: string;
  readonly session: DesktopSession;
  readonly fetch?: typeof fetch;
}

/** The feedback bridge's account calls: optional, verified by the identity server, only id and email out. */
export function createFeedbackIdentity(config: DesktopIdentityConfiguration) {
  const { session } = config;
  const verify = async (): Promise<SignedInUser | null> => {
    const token = await session.accessToken();
    if (token === undefined) return null;
    try { return await verifiedUser(config.identityUrl, token, config.fetch); }
    catch (error) {
      if (isRefused(error)) { await session.signOut(); return null; }
      throw error;
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
 * Offered only when a build carries both a public WorkOS client ID and an explicit HTTPS identity endpoint; otherwise
 * there is no sign-in at all. Sign-in goes through the system browser and returns on the storytree-auth://callback deep
 * link, which callbackSession completes. Every token stays in the main process with the SDK's session manager.
 */

/** The deep link a sign-in returns on, registered with the OS by the packaged app. */
export const AUTH_CALLBACK = "storytree-auth://callback";
export const AUTH_SCHEME = "storytree-auth";

/** How long a sign-in waits for the browser to come back before it is given up. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export interface FeedbackIdentityConfig {
  readonly clientId: string;
  readonly identityUrl: string;
}

/** The build's public sign-in settings, or undefined (no sign-in offered) unless both are present and well formed. */
export function feedbackIdentityConfig(clientId: string | undefined, identityUrl: string | undefined): FeedbackIdentityConfig | undefined {
  if (clientId === undefined || identityUrl === undefined) return undefined;
  if (!/^client_[A-Za-z0-9]+$/.test(clientId)) return undefined;
  let url: URL;
  try {
    url = new URL(identityUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  return { clientId, identityUrl };
}

/** The sign-in callbacks among a start's arguments (a Windows or Linux deep link arrives as one). */
export function callbackUrls(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.toLowerCase().startsWith(`${AUTH_SCHEME}://`));
}

/** The part of the SDK's main-process session manager this module drives. */
export interface SignInEngine {
  beginSignIn(): Promise<void>;
  completeCallback(code: string, state: string | undefined): Promise<unknown>;
  getAccessToken(): Promise<string | null>;
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
    accessToken: async () => (await engine.getAccessToken()) ?? undefined,
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
