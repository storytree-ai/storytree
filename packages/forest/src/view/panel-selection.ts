/** Forest capability 3: the story and artifact share one panel slot. */
export type Selection = { kind: "story" | "note"; id: string } | undefined;

export class PanelSelection {
  current: Selection;
  constructor(private readonly changed: (selection: Selection) => void) {}
  story(id: string | undefined): void { this.show(id === undefined ? undefined : { kind: "story", id }); }
  note(id: string): void { this.show({ kind: "note", id }); }
  close(): void { this.show(undefined); }
  key(key: string): void { if (key === "Escape") this.close(); }
  private show(selection: Selection): void {
    this.current = selection;
    this.changed(selection);
  }
}
