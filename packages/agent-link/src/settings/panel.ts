import type { SettingsResult } from "./bridge.js";
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
