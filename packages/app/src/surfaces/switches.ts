// Capability 3 · Surfaces
import { readSurfaceChoices, setSurfaceChoice } from "@storytree/project-and-caller";

import type { SurfacesResult } from "./bridge.js";

export interface SurfaceChoice {
  readonly id: string;
  readonly name: string;
}

export interface SurfaceSettingDeclaration {
  readonly id: string;
  readonly name: string;
  readonly meaning: string;
  readonly default: string;
  readonly choices: readonly SurfaceChoice[];
}

export interface SurfaceDeclaration {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly switchable: boolean;
  readonly within?: string;
  readonly follows?: string;
  readonly settings: readonly SurfaceSettingDeclaration[];
}

export interface SurfaceSettingReading extends SurfaceSettingDeclaration {
  readonly value: string;
  readonly source: "default" | "set";
}

export interface SurfaceReading extends Omit<SurfaceDeclaration, "settings"> {
  readonly on: boolean;
  readonly source: "default" | "set";
  readonly settings: readonly SurfaceSettingReading[];
}

export function readSurfaces(declared: readonly SurfaceDeclaration[], home?: string): SurfaceReading[] {
  const saved = readSurfaceChoices(home);
  const own = (surface: SurfaceDeclaration): boolean => !surface.switchable || saved[surface.id]?.on !== false;
  const byId = new Map(declared.map((surface) => [surface.id, surface]));
  return declared.map((surface) => {
    const followed = surface.follows === undefined ? undefined : byId.get(surface.follows);
    const chosen = saved[surface.id] ?? {};
    return {
      ...surface,
      on: own(surface) && (followed === undefined || own(followed)),
      source: surface.switchable && typeof chosen.on === "boolean" ? "set" : "default",
      settings: surface.settings.map((setting) => {
        const value = chosen[setting.id];
        const known = typeof value === "string" && setting.choices.some(({ id }) => id === value);
        return { ...setting, value: known ? value : setting.default, source: known ? "set" : "default" };
      }),
    };
  });
}

export function setSurface(declared: readonly SurfaceDeclaration[], words: readonly string[], home?: string): SurfaceReading[] {
  const [id, second, third, ...rest] = words;
  const surface = declared.find((each) => each.id === id);
  if (surface === undefined) throw new Error(`There is no surface ${JSON.stringify(id ?? "")}. The surfaces are: ${declared.map((each) => each.id).join(", ")}.`);
  if (third === undefined && rest.length === 0) {
    if (!surface.switchable) throw new Error(`${surface.name} is always on${surface.follows === undefined ? "" : `: it goes on and off with ${declared.find((each) => each.id === surface.follows)?.name ?? surface.follows}`}.`);
    if (second !== "on" && second !== "off") throw new Error(`Switch ${surface.name} on or off.`);
    setSurfaceChoice(surface.id, "on", second === "on", home);
    return readSurfaces(declared, home);
  }
  const setting = surface.settings.find((each) => each.id === second);
  if (setting === undefined || rest.length > 0) {
    throw new Error(`${surface.name} has no setting ${JSON.stringify(second ?? "")}${surface.settings.length === 0 ? "" : `. Its settings are: ${surface.settings.map((each) => each.id).join(", ")}`}.`);
  }
  if (!setting.choices.some((choice) => choice.id === third)) {
    throw new Error(`${surface.name}'s ${setting.name.toLowerCase()} is one of: ${setting.choices.map((choice) => choice.id).join(", ")}.`);
  }
  setSurfaceChoice(surface.id, setting.id, third!, home);
  return readSurfaces(declared, home);
}

export function surfacesActions(declared: readonly SurfaceDeclaration[], home?: string) {
  const result = (action: () => readonly SurfaceReading[]): SurfacesResult => {
    try { return { ok: true, value: action() }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };
  return {
    async readSurfaces(): Promise<SurfacesResult> { return result(() => readSurfaces(declared, home)); },
    async saveSurface(words: unknown): Promise<SurfacesResult> {
      return result(() => {
        if (!Array.isArray(words) || !words.every((word) => typeof word === "string")) throw new Error("Give the surface and its change as words.");
        return setSurface(declared, words, home);
      });
    },
  };
}
