import type { LibraryReading, SettingGroup, SettingsReading } from "./settings.js";

/** Data only: safe to import into the sandboxed page or preload. */
export type SettingsResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };
export interface NumberReading {
  readonly name: string;
  readonly group: SettingGroup;
  readonly type: string;
  readonly unit?: string;
  readonly default: number;
  readonly value: number;
  readonly meaning: string;
  readonly source: "default" | "set";
}
export type PanelReadings = SettingsReading | Readonly<Record<string, NumberReading | LibraryReading>>;

export interface SettingsBridge {
  readSettings(): Promise<SettingsResult<SettingsReading>>;
  saveSetting(name: string, values: readonly string[]): Promise<SettingsResult<SettingsReading>>;
}

export const SETTINGS_CHANNELS = {
  readSettings: "storytree:read-settings",
  saveSetting: "storytree:save-setting",
} as const;
