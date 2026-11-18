// Capability 1 · Lifecycle
export interface SignInState {
  available: boolean;
  on: boolean;
}

export interface LifecycleBridge {
  readSignIn(): Promise<SignInState>;
  setSignIn(on: boolean): Promise<SignInState>;
}

export const LIFECYCLE_CHANNELS = {
  readSignIn: "storytree:read-sign-in",
  setSignIn: "storytree:set-sign-in",
} as const satisfies Record<keyof LifecycleBridge, string>;
