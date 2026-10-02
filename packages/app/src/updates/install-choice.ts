/** Capability 4 · Updates, contracts 4.13–4.14 (ADR-0871 D2): when the user lets a release install itself. */
export type InstallChoice =
  | { readonly mode: "quiet" }
  | { readonly mode: "hours"; readonly from: string; readonly to: string }
  | { readonly mode: "manual" };

export interface InstallChoiceState { readonly available: boolean; readonly choice: InstallChoice }

export function installChoice(_options: { available: boolean; file: string }) {
  return {
    read(): InstallChoiceState { throw new Error("not built"); },
    set(_choice: unknown): InstallChoiceState { throw new Error("not built"); },
  };
}

export function nextInstallAt(_choice: InstallChoice, _now: Date): Date | undefined { throw new Error("not built"); }
