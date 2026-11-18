// Capability 3 · Story node render

export function sheetDrag(event: { button: number; ctrlKey: boolean; isPrimary: boolean }): "pan" | "spin" | undefined {
  if (!event.isPrimary) return undefined;
  if (event.button === 2 || (event.button === 0 && event.ctrlKey)) return "spin";
  return event.button === 0 ? "pan" : undefined;
}
