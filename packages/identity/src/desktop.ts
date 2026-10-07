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
