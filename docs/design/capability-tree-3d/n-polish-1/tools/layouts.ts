/** Round 13's arrangements (layouts/<name>.json, written by tools/layout.ts), one picked by `?layout=<name>`; the chosen
 * one by default. build.mjs writes layouts.gen.ts, which imports every one of them. */
import { LAYOUTS } from "./layouts.gen.ts";

export const CHOSEN = "chosen";
const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("layout");
export const layoutName = asked && asked in LAYOUTS ? asked : CHOSEN in LAYOUTS ? CHOSEN : Object.keys(LAYOUTS)[0]!;
export const layout = LAYOUTS[layoutName as keyof typeof LAYOUTS] as unknown as {
  owners: string[]; harbour: { dock: { x: number; z: number }; sea: { x: number; z: number } }; keys: { dock: { x: number; z: number }; sea: { x: number; z: number } };
  open: { band: number; mouth: number }; landings: { capability: string; at: { x: number; z: number }; links: number }[]; net?: Record<string, number>;
};
