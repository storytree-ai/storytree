/** Forest capability 3: the story and artifact share one panel slot. A story picked by its territory names that capability (3.15). */
export type Selection = { kind: "story"; id: string; capability?: string } | { kind: "note"; id: string } | undefined;

export class PanelSelection {
  current: Selection;
  constructor(private readonly changed: (selection: Selection) => void) {}
  story(id: string | undefined, capability?: string): void { this.show(id === undefined ? undefined : capability === undefined ? { kind: "story", id } : { kind: "story", id, capability }); }
  note(id: string): void { this.show({ kind: "note", id }); }
  close(): void { this.show(undefined); }
  key(key: string): void { if (key === "Escape") this.close(); }
  private show(selection: Selection): void {
    this.current = selection;
    this.changed(selection);
  }
}
