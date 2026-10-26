/** Capability 2 · Settings. */
import { SETTINGS_CHANNELS, type SettingsResult } from "./bridge.js";
import { readSettings, setLibrary, setSetting, type SettingsReading } from "./settings.js";

/** Keep errors as data: Electron's thrown-error wrapper would change the CLI's refusal text. */
export function settingsActions(home?: string) {
  const result = (action: () => SettingsReading): SettingsResult<SettingsReading> => {
    try { return { ok: true, value: action() }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  return {
    async readSettings(): Promise<SettingsResult<SettingsReading>> { return result(() => readSettings(home)); },
    async saveSetting(name: unknown, values: unknown): Promise<SettingsResult<SettingsReading>> {
      return result(() => {
        if (typeof name !== "string" || !Array.isArray(values) || !values.every((value) => typeof value === "string")) {
          throw new Error("Give a setting name and its text values.");
        }
        if (name === "library") setLibrary(values, home);
        else {
          if (values.length !== 1) throw new Error("Give one value for this setting.");
          setSetting(name, values[0]!, home);
        }
        return readSettings(home);
      });
    },
  };
}

export { SETTINGS_CHANNELS } from "./bridge.js";

/** What a host offers the settings panel's page part: the app's home, whose settings file it reads and writes. */
export interface SettingsPageFrame {
  readonly home: string;
}

/** The main process's side, named in its manifest (`pageAnswers`, ADR-1021): the desktop answers the panel's reads and saves with it. */
export const settingsPageAnswers = [(frame: SettingsPageFrame) => ({ channels: SETTINGS_CHANNELS, answers: settingsActions(frame.home) })];
