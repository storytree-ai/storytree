/**
 * Capability 1 · Lifecycle. Which of the mark's colourways the tray and window wear, and its pictures, rendered by the mark's
 * package (@storytree/mark) when the app starts, so the packaged app needs no extra file and the frame draws nothing itself.
 */
import { renderMark, writePng } from "@storytree/mark";

/** The readings of Electron's nativeTheme the icon follows, and its "updated" event. */
export interface TaskbarTheme {
  readonly shouldUseDarkColors: boolean;
  /** The taskbar's own setting (Windows and macOS); Electron leaves it undefined where it has none. */
  readonly shouldUseDarkColorsForSystemIntegratedUI?: boolean | undefined;
  on(event: "updated", listener: () => void): unknown;
}

export type IconColourway = "day" | "night";

/** Night on a dark taskbar, day otherwise; the apps' setting stands in where the taskbar reports none. */
export function iconColourway(theme: TaskbarTheme): IconColourway {
  return (theme.shouldUseDarkColorsForSystemIntegratedUI ?? theme.shouldUseDarkColors) ? "night" : "day";
}

/** The mark in a colourway as a PNG at each size. */
export function markIcon(colourway: IconColourway, sizes: readonly number[]): { size: number; png: Buffer }[] {
  return sizes.map((size) => ({ size, png: writePng(renderMark(colourway, size), size) }));
}

/** Wears the colourway for the taskbar now, and again each time the taskbar's setting changes it. */
export function followTaskbar(theme: TaskbarTheme, wear: (colourway: IconColourway) => void): void {
  let worn = iconColourway(theme);
  wear(worn);
  theme.on("updated", () => {
    const next = iconColourway(theme);
    if (next !== worn) wear(worn = next);
  });
}
