/**
 * Capability 3 · Story node render. What a pointer press drags on the glass sheet, kept apart from the sheet's geometry so the
 * lag recorder, which reads it to know a turn of the map, loads no drawing code.
 */

/** What a pointer press drags: the left button pans, the right button or Ctrl with the left spins and tilts (ADR-1060 D2,
 * ADR-1062 D2): its sideways part spins the sheet, its up-and-down part tilts it (`sheetSpinTilt`). */
export function sheetDrag(event: { button: number; ctrlKey: boolean; isPrimary: boolean }): "pan" | "spin" | undefined {
  if (!event.isPrimary) return undefined;
  if (event.button === 2 || (event.button === 0 && event.ctrlKey)) return "spin";
  return event.button === 0 ? "pan" : undefined;
}
