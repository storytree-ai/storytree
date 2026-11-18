// Capability 6 · Social sign-in and session
import type { SignedInUser } from "./client.js";
import { TokenRefused, workosTokenVerifier, type WorkosAccount } from "./workos-token.js";

export { IDENTITY_AUDIENCE } from "./workos-token.js";

export type DesktopAccount = WorkosAccount;

export interface DesktopSession {
  storageProtected(): boolean | Promise<boolean>;
  current(): Promise<{ readonly accessToken: string; readonly user: DesktopAccount } | undefined>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}
export interface DesktopIdentityConfiguration {
  readonly clientId: string;
  readonly session: DesktopSession;
  readonly fetch?: typeof fetch;
}

export function createFeedbackIdentity(config: DesktopIdentityConfiguration) {
  const { session } = config;
  const check = workosTokenVerifier(config.clientId, config.fetch);
  const verify = async (): Promise<SignedInUser | null> => {
    const signedIn = await session.current();
    if (signedIn === undefined) return null;
    try {
      return await check(signedIn.accessToken, signedIn.user);
    } catch (error) {
      if (!(error instanceof TokenRefused)) {
        throw new Error("Sign-in is temporarily unavailable. Try again later; Storytree still works without an account.", { cause: error });
      }
      await session.signOut();
      return null;
    }
  };
  return {
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

export const AUTH_CALLBACK = "storytree-auth://callback";
export const AUTH_SCHEME = "storytree-auth";

export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export interface FeedbackIdentityConfig {
  readonly clientId: string;
}

export function feedbackIdentityConfig(clientId: string | undefined): FeedbackIdentityConfig | undefined {
  if (clientId === undefined || !/^client_[A-Za-z0-9]+$/.test(clientId)) return undefined;
  return { clientId };
}

export function callbackUrls(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.toLowerCase().startsWith(`${AUTH_SCHEME}://`));
}

export interface SignInEngine {
  beginSignIn(): Promise<void>;
  completeCallback(code: string, state: string | undefined): Promise<unknown>;
  getUser(): Promise<{ user: null } | { user: DesktopAccount; accessToken: string }>;
  signOut(): Promise<unknown>;
}

export interface CallbackSession extends DesktopSession {
  storageProtected(): boolean;
  callback(url: string): Promise<void>;
}

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
