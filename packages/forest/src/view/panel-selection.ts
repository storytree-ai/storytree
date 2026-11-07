/** Capability 3 · Story node render. Forest capability 3: the story and artifact share one panel slot. A story picked by its territory names that capability (3.15);
 * by a gate, the pair of capabilities the gate joins (3.88); one picked in the panel names it too, so the map rings it (3.91). */
import type { GlobeSwitches, SheetFace } from "./globe-switches.js";

export type Selection = { kind: "story"; id: string; capability?: string; gate?: readonly [string, string] } | { kind: "note"; id: string } | undefined;

export class PanelSelection {
  current: Selection;
  /** `changed` hears every new selection, and whether the panel made it itself, so needs no telling. */
  constructor(private readonly changed: (selection: Selection, made: { fromPanel: boolean }) => void) {}
  story(id: string | undefined, capability?: string): void { this.show(id === undefined ? undefined : capability === undefined ? { kind: "story", id } : { kind: "story", id, capability }); }
  gate(id: string, between: readonly [string, string]): void { this.show({ kind: "story", id, gate: between }); }
  /** A click on the map: a gate's pair when it picked one (3.88), else its story and territory's capability (3.15), or none. */
  picked(id: string | undefined, capability?: string, gate?: readonly [string, string]): void {
    if (id !== undefined && gate !== undefined) this.gate(id, gate);
    else this.story(id, capability);
  }
  /** The panel picked `capability` of the selected story (3.91); with no story selected it names nothing. */
  chose(capability: string): void {
    if (this.current?.kind === "story") this.show({ kind: "story", id: this.current.id, capability }, true);
  }
  note(id: string): void { this.show({ kind: "note", id }); }
  close(): void { this.show(undefined); }
  key(key: string): void { if (key === "Escape") this.close(); }
  /** Stories off hides the islands, so a selected story and its panel go; Library off hides the notes, so a note's card goes (3.10). */
  switched(switches: GlobeSwitches): void {
    if ((!switches.stories && this.current?.kind === "story") || (!switches.library && this.current?.kind === "note")) this.close();
  }
  /** The glass sheet's `face` pressed: a story stays selected in both looks, and pressing Stories closes a note's card (ADR-1043 D3, ADR-1062 D3). */
  turned(face: SheetFace): void {
    if (face === "stories" && this.current?.kind === "note") this.close();
  }
  private show(selection: Selection, fromPanel = false): void {
    this.current = selection;
    this.changed(selection, { fromPanel });
  }
}
