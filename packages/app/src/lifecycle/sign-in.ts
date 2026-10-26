/**
 * Capability 1 · Lifecycle. Opening at sign-in (lifecycle 1.12): the installed app registers itself to open when the user
 * signs in, straight to the tray (`--background`), so its release updater runs all day and the
 * hooks it installed follow each release. On by default; the gear's Updates section turns it off,
 * and that choice is kept in the app's home (`sign-in.json`) so the next start does not register
 * it again. Only an installed app registers: a development copy, a portable build or a runtime
 * slot would leave sign-in pointing at a build that is not the one the user installed.
 *
 * Electron's login item passes `args` only on Windows; on a Mac it would open the window at every
 * sign-in, and its `wasOpenedAtLogin` cannot tell such a start apart from macOS 13 on. So on a Mac
 * the app registers a per-user LaunchAgent instead, which starts it with `--background` itself. On Linux
 * Electron's login item does nothing at all, so the app writes an XDG autostart entry, which the desktop
 * session reads at sign-in, starting the installed AppImage with `--background`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SignInState } from "./bridge.js";

export type { SignInState };

/** What the app asks Electron's app.setLoginItemSettings for. */
export interface LoginItem {
  openAtLogin: boolean;
  args: string[];
  /** The value's name under the user's Run key on Windows, which the uninstaller removes. */
  name: string;
}

export const SIGN_IN_NAME = "storytree 0.3";
/** The Mac LaunchAgent's label and file name: the app's bundle id. */
export const SIGN_IN_LABEL = "ai.storytree.desktop-0-3";
/** The Linux autostart entry's file name, in `$XDG_CONFIG_HOME/autostart`. */
export const SIGN_IN_DESKTOP_FILE = "storytree-0.3.desktop";

interface LoginItems { set(item: LoginItem): void }

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One argument of a desktop entry's Exec key: quoted when it holds a reserved character, its `%` doubled. */
const execArg = (arg: string): string => {
  const quoted = /[\s"'\\><~|&;$*?#()`]/.test(arg) ? `"${arg.replace(/(["`$\\])/g, "\\$1")}"` : arg;
  // The key's value is itself an escaped string, so each backslash the quoting left is doubled again.
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
};

/**
 * The Linux login item: an XDG autostart entry in `autostart`, written when on and removed when off. Where the kernel
 * blocks Chromium's sandbox the installer's menu entry starts the app with `--no-sandbox` (decision_624dbe5bcddb), so an
 * app started that way (`sandboxOff`) writes it into the autostart entry too, or its sign-in start would fail.
 */
function autostartEntry(options: { execPath: string; autostart: string; sandboxOff?: boolean }): LoginItems {
  const file = path.join(options.autostart, SIGN_IN_DESKTOP_FILE);
  return {
    set(item) {
      if (!item.openAtLogin) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(options.autostart, { recursive: true });
      writeFileSync(file, `[Desktop Entry]
Type=Application
Name=${SIGN_IN_NAME}
Exec=${[options.execPath, ...(options.sandboxOff ? ["--no-sandbox"] : []), ...item.args].map(execArg).join(" ")}
Terminal=false
X-GNOME-Autostart-enabled=true
`);
    },
  };
}

/**
 * Where the platform keeps a login item: Electron's on Windows, a LaunchAgent in `launchAgents` on a Mac,
 * an autostart entry in `autostart` on Linux.
 */
export function loginItemsFor(platform: NodeJS.Platform, options: { electron: LoginItems; execPath: string; launchAgents: string; autostart: string; sandboxOff?: boolean }): LoginItems {
  if (platform === "linux") return autostartEntry(options);
  if (platform !== "darwin") return options.electron;
  const file = path.join(options.launchAgents, `${SIGN_IN_LABEL}.plist`);
  return {
    set(item) {
      // A Mac login item Electron registered would open the window beside the agent's start.
      options.electron.set({ ...item, openAtLogin: false });
      if (!item.openAtLogin) {
        rmSync(file, { force: true });
        return;
      }
      const args = [options.execPath, ...item.args].map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
      mkdirSync(options.launchAgents, { recursive: true });
      // AbandonProcessGroup: an update relaunches the app, and launchd must not stop that start when this one quits.
      writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SIGN_IN_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>
`);
    },
  };
}

export function signIn(options: { installed: boolean; file: string; loginItems: LoginItems }) {
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
