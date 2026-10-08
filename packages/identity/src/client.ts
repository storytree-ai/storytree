/** Capability 2 · Social sign-in and session. */
import { setTimeout } from "node:timers/promises";
import { TokenRefused, workosTokenVerifier } from "./workos-token.js";

/** Only this reviewed identity crosses into a CLI answer or feedback draft. */
export interface SignedInUser { readonly id: string; readonly email: string }
/** Private refresh-token persistence. The host must serialize commands sharing a store. */
export interface SessionStore {
  read(): Promise<string | undefined>;
  write(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}
export interface DevicePrompt { readonly userCode: string; readonly verificationUri: string }
export interface ClientConfiguration {
  readonly clientId: string;
  /**
   * No longer called: WorkOS's tokens are verified here (question D). Still refused when not HTTPS, until the
   * command line stops passing STORYTREE_IDENTITY_URL.
   */
  readonly identityUrl?: string;
  readonly store: SessionStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

class SignInError extends Error {}
const unavailable = () => new SignInError("Sign-in is temporarily unavailable. Try again later; Storytree still works without an account.");
const refused = () => new SignInError("Your sign-in could not be verified. Sign in again.");
const expired = () => new SignInError("The sign-in code expired. Start sign-in again.");
const cancelled = () => new SignInError("Sign-in cancelled.");
const api = "https://api.workos.com/user_management/";

/** Public-client device authorization. No API key, provider secret, or unverified identity is accepted. */
export function createIdentityClient(config: ClientConfiguration) {
  if (!/^client_[A-Za-z0-9_-]+$/.test(config.clientId)) throw new Error("Sign-in needs a public WorkOS client ID.");
  if (config.identityUrl !== undefined && !httpsUrl(config.identityUrl)) throw new Error("Sign-in needs an explicit HTTPS identity endpoint.");
  const request = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const wait = config.wait ?? ((ms, signal) => setTimeout(ms, undefined, { signal }));
  const call = caller(request);
  const post = (path: string, fields: Record<string, string>, signal?: AbortSignal) => call(api + path, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config.clientId, ...fields }),
  }, signal);
  const check = workosTokenVerifier(config.clientId, request);
  /** The exchange's user, only once its access token verifies against the client's published keys. */
  const resolve = async (data: Record<string, unknown>): Promise<SignedInUser> => {
    const account = data.user;
    if (typeof account !== "object" || account === null) throw refused();
    const { id, email, email_verified: emailVerified } = account as Record<string, unknown>;
    if (typeof id !== "string" || typeof email !== "string" || typeof emailVerified !== "boolean") throw refused();
    try { return await check(String(data.access_token), { id, email, emailVerified }); }
    catch (error) { throw error instanceof TokenRefused ? refused() : unavailable(); }
  };
  // Serialize one instance; a CLI host uses withSessionStore to serialize across processes too.
  let active = false;
  const exclusive = async <T>(act: () => Promise<T>) => {
    if (active) throw new SignInError("A sign-in command is already running. Finish or cancel it first.");
    active = true;
    try { return await act(); } finally { active = false; }
  };
  return {
    signIn: (show: (prompt: DevicePrompt) => void | Promise<void>, signal?: AbortSignal): Promise<SignedInUser> => exclusive(async () => {
      if (signal?.aborted) throw cancelled();
      // Explicit sign-in replaces the local session; failures remain signed out.
      await config.store.clear();
      const authorization = await post("authorize/device", {}, signal);
      if (!authorization.ok) throw unavailable();
      const { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri, expires_in: lifetime } = authorization.data;
      let interval = authorization.data.interval ?? 5;
      if (!text(deviceCode) || !text(userCode) || !httpsUrl(verificationUri, true)
        || !seconds(lifetime) || lifetime > 3600 || !seconds(interval)) throw refused();
      const deadline = now() + lifetime * 1000;
      const timeout = AbortSignal.timeout(lifetime * 1000);
      const pending = signal ? AbortSignal.any([signal, timeout]) : timeout;
      await show({ userCode, verificationUri });
      try {
        for (;;) {
          if (signal?.aborted) throw cancelled();
          if (now() + interval * 1000 >= deadline) throw expired();
          await wait(interval * 1000, pending);
          if (pending.aborted || now() >= deadline) throw expired();
          const result = await post("authenticate", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode }, pending);
          if (result.ok) {
            const { refreshToken } = tokens(result.data);
            const user = await resolve(result.data);
            pending.throwIfAborted();
            await config.store.write(refreshToken);
            return user;
          }
          if (result.data.error === "authorization_pending") continue;
          // RFC 8628 section 3.5: add five seconds, for this and all subsequent requests.
          if (result.data.error === "slow_down") { interval += 5; continue; }
          if (result.data.error === "access_denied") throw new SignInError("Sign-in was denied. Storytree still works without an account.");
          if (result.data.error === "expired_token") throw expired();
          throw unavailable();
        }
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (timeout.aborted) throw expired();
        throw error instanceof SignInError ? error : unavailable();
      }
    }),
    status: (): Promise<SignedInUser | null> => exclusive(async () => {
      const saved = await config.store.read();
      if (saved === undefined) return null;
      const result = await post("authenticate", { grant_type: "refresh_token", refresh_token: saved });
      if (result.data.error === "invalid_grant" && result.status === 400) { await config.store.clear(); return null; }
      if (!result.ok) throw unavailable();
      const { refreshToken } = tokens(result.data);
      // Refresh tokens rotate: keep the replacement even if WorkOS's keys are temporarily unreachable.
      await config.store.write(refreshToken);
      try { return await resolve(result.data); }
      catch (error) {
        if (isRefused(error)) { await config.store.clear(); return null; }
        throw error;
      }
    }),
    /** Local sign-out: no claim to revoke a browser's hosted WorkOS cookie. */
    signOut: (): Promise<void> => exclusive(() => config.store.clear()),
  };
}

function caller(request: typeof fetch) {
  return async (url: string, init: RequestInit, signal?: AbortSignal) => {
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await request(url, { ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      return { status: response.status, ok: response.ok, data: object(await response.json()) };
    } catch {
      if (signal?.aborted) throw cancelled();
      throw unavailable();
    }
  };
}
/** True when the session was refused, as opposed to WorkOS being unreachable. */
function isRefused(error: unknown): boolean { return error instanceof SignInError && error.message === refused().message; }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw refused();
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/[\x00-\x20\x7f]/.test(value); }
function seconds(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 3600; }
function httpsUrl(value: unknown, query = false): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && (query || !url.search);
  } catch { return false; }
}
function tokens(data: Record<string, unknown>): { accessToken: string; refreshToken: string } {
  if (!text(data.access_token) || !text(data.refresh_token)) throw refused();
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
