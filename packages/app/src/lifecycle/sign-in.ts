/**
 * Capability 1 · Lifecycle. Opening at sign-in (lifecycle 1.12): the installed app registers itself to open when the user
 * signs in, straight to the tray (`--background`), so its release updater runs all day and the
 * hooks it installed follow each release. On by default; the gear's Updates section turns it off,
 * and that choice is kept in the app's home (`sign-in.json`) so the next start does not register
 * it again. Only an installed app registers: a development copy, a portable build or a runtime
 * slot would leave sign-in pointing at a build that is not the one the user installed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** What the app asks Electron's app.setLoginItemSettings for. */
export interface LoginItem {
  openAtLogin: boolean;
  args: string[];
  /** The value's name under the user's Run key on Windows, which the uninstaller removes. */
  name: string;
}

/** Whether the app can open at sign-in here, and whether it will. */
export interface SignInState {
  available: boolean;
  on: boolean;
}

export const SIGN_IN_NAME = "storytree 0.3";

export function signIn(options: { installed: boolean; file: string; loginItems: { set(item: LoginItem): void } }) {
  const choice = (): boolean => {
    try {
      const stored = JSON.parse(readFileSync(options.file, "utf8")) as { open?: unknown };
      return stored.open !== false;
    } catch {
      return true; // no choice made yet (or one that cannot be read): the default, on
    }
  };
  const register = (on: boolean): void => options.loginItems.set({ openAtLogin: on, args: ["--background"], name: SIGN_IN_NAME });
  const read = (): SignInState => ({ available: options.installed, on: options.installed && choice() });
  return {
    read,
    /** At start: register, or unregister, as the user's choice says. */
    apply(): void {
      if (options.installed) register(choice());
    },
    /** The gear's switch: keep the choice, then apply it. */
    set(on: unknown): SignInState {
      if (!options.installed) throw new Error("Only the installed app can open at sign-in.");
      if (typeof on !== "boolean") throw new Error("Say on or off.");
      mkdirSync(path.dirname(options.file), { recursive: true });
      writeFileSync(options.file, `${JSON.stringify({ open: on })}\n`);
      register(on);
      return read();
    },
  };
}
