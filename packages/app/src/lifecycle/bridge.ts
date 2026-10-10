/** Capability 1 · Lifecycle. The page's opening-at-sign-in operations and the channels they travel on (ADR-0649). Data only: safe for the page and preload. */
import type { SignInState } from "./sign-in.js";

export interface LifecycleBridge {
  /** Whether the app opens at sign-in, in the tray (lifecycle 1.12), and whether it can here. */
  readSignIn(): Promise<SignInState>;
  /** Turn opening at sign-in on or off; refused where the app is not installed. */
  setSignIn(on: boolean): Promise<SignInState>;
}

export const LIFECYCLE_CHANNELS = {
  readSignIn: "storytree:read-sign-in",
  setSignIn: "storytree:set-sign-in",
} as const satisfies Record<keyof LifecycleBridge, string>;
