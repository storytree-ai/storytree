// Capability 1 · Lifecycle
import { renderMark, writePng } from "@storytree/mark";

export interface TaskbarTheme {
  readonly shouldUseDarkColors: boolean;
  readonly shouldUseDarkColorsForSystemIntegratedUI?: boolean | undefined;
  on(event: "updated", listener: () => void): unknown;
}

export type IconColourway = "day" | "night";

export function iconColourway(theme: TaskbarTheme): IconColourway {
  return (theme.shouldUseDarkColorsForSystemIntegratedUI ?? theme.shouldUseDarkColors) ? "night" : "day";
}

export function markIcon(colourway: IconColourway, sizes: readonly number[]): { size: number; png: Buffer }[] {
  return sizes.map((size) => ({ size, png: writePng(renderMark(colourway, size), size) }));
}

export function followTaskbar(theme: TaskbarTheme, wear: (colourway: IconColourway) => void): void {
  let worn = iconColourway(theme);
  wear(worn);
  theme.on("updated", () => {
    const next = iconColourway(theme);
    if (next !== worn) wear(worn = next);
  });
}
