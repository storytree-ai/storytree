// Capability 1 · Lifecycle
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SignInState } from "./bridge.js";

export type { SignInState };

export interface LoginItem {
  openAtLogin: boolean;
  args: string[];
  name: string;
}

export const SIGN_IN_NAME = "storytree 0.3";
export const SIGN_IN_LABEL = "ai.storytree.desktop-0-3";
export const SIGN_IN_DESKTOP_FILE = "storytree-0.3.desktop";

interface LoginItems { set(item: LoginItem): void }

const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const execArg = (arg: string): string => {
  const quoted = /[\s"'\\><~|&;$*?#()`]/.test(arg) ? `"${arg.replace(/(["`$\\])/g, "\\$1")}"` : arg;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
};

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

export function loginItemsFor(platform: NodeJS.Platform, options: { electron: LoginItems; execPath: string; launchAgents: string; autostart: string; sandboxOff?: boolean }): LoginItems {
  if (platform === "linux") return autostartEntry(options);
  if (platform !== "darwin") return options.electron;
  const file = path.join(options.launchAgents, `${SIGN_IN_LABEL}.plist`);
  return {
    set(item) {
      options.electron.set({ ...item, openAtLogin: false });
      if (!item.openAtLogin) {
        rmSync(file, { force: true });
        return;
      }
      const args = [options.execPath, ...item.args].map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
      mkdirSync(options.launchAgents, { recursive: true });
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
      return true;
    }
  };
  const register = (on: boolean): void => options.loginItems.set({ openAtLogin: on, args: ["--background"], name: SIGN_IN_NAME });
  const read = (): SignInState => ({ available: options.installed, on: options.installed && choice() });
  return {
    read,
    apply(): void {
      if (options.installed) register(choice());
    },
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
