/**
 * Capability 2 · Storytree projects. The desktop page's story panel (the forest's capability 4 drill-down, mounted by the app): the
 * library's card for a selected note, or the selected story's drill-down with one capability shown below its diagram (ADR-0659
 * D2). A redraw of the same story keeps what the user opened: its open details, the panel tree's place (ADR-0743) and the larger
 * tree window popped out from it.
 */
import { selectedCapability, type StoryPanel } from "@storytree/forest";

/** The panel tree's moving space (the forest's attachPanZoom). */
export interface PanelSpace<View = unknown> {
  readonly view: View;
  place(view: View): void;
  open(): void;
  stop(): void;
}

/** The larger tree window (the forest's mountTreeSpace). */
export interface TreeWindow {
  show(panel: StoryPanel, selected: string | undefined): void;
  close(): void;
  readonly open: boolean;
  stop(): void;
}

export interface StoryPanelParts {
  /** The selected story node (`data-selected`) and note (`data-note`) live on this body's dataset. */
  body: HTMLElement;
  /** The drill-down for `story` as the project now reads, or none. */
  drill(story: string): StoryPanel | undefined;
  render(drilled: StoryPanel, selected: string | undefined): string;
  /** Let `frame` move `surface`; `choose` hears a card clicked. */
  space(frame: HTMLElement, surface: HTMLElement, choose: (id: string) => void): PanelSpace;
  /** The larger tree window, when the capability tree is on. */
  tree(): TreeWindow | undefined;
  /** Mount the library's card for the selected note; returns its stop. */
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  /** Select nothing on the forest, as a click on empty space would. */
  deselect(): void;
}

export interface StoryPanelView {
  /** Draw the panel for the selection on the body, or hide it. */
  show(): void;
  /** Show `capability` below the open story's diagram (undefined for the story's first). */
  choose(capability: string | undefined): void;
  stop(): void;
}

export function storyPanel(panel: HTMLElement, parts: StoryPanelParts): StoryPanelView {
  /** The capability shown below the open story's diagram: the one clicked, or the one the panel opened on, so it holds while the project redraws. */
  let chosen: string | undefined;
  /** The panel's own tree space, moved by the pointer, and whose story it shows. */
  let inPanel: { story: string; moving: PanelSpace } | undefined;
  let card: (() => void) | undefined;

  const letSpaceGo = (): void => {
    parts.tree()?.close();
    inPanel?.moving.stop();
    inPanel = undefined;
  };

  const show = (): void => {
    if (parts.body.dataset.note !== undefined) {
      letSpaceGo();
      panel.hidden = false;
      card ??= parts.libraryCard(panel, () => parts.deselect());
      return;
    }
    card?.();
    card = undefined;
    const story = parts.body.dataset.selected;
    const drilled = story === undefined ? undefined : parts.drill(story);
    panel.hidden = drilled === undefined;
    if (drilled === undefined) {
      letSpaceGo();
      panel.replaceChildren();
      return;
    }
    const selected = selectedCapability(drilled, chosen);
    chosen = selected;
    const open = new Set([...panel.querySelectorAll<HTMLElement>("details[open]")].map((node) => node.closest<HTMLElement>("[data-capability-id]")?.dataset.capabilityId));
    panel.innerHTML = parts.render(drilled, selected);
    for (const node of panel.querySelectorAll<HTMLElement>(".panel-detail")) {
      if (open.has(node.dataset.capabilityId)) node.querySelector("details")?.setAttribute("open", "");
    }
    // The tree's own space keeps its view while the same story redraws.
    const kept = inPanel?.story === drilled.story ? inPanel.moving.view : undefined;
    inPanel?.moving.stop();
    inPanel = undefined;
    const frame = panel.querySelector<HTMLElement>(".panel-tree-frame");
    const surface = frame?.querySelector<HTMLElement>(".panel-tree-surface");
    if (frame != null && surface != null) {
      const moving = parts.space(frame, surface, (id) => {
        chosen = id;
        show();
        panel.querySelector<SVGGElement>(".panel-diagram .selected")?.focus({ preventScroll: true });
      });
      if (kept === undefined) moving.open();
      else moving.place(kept);
      inPanel = { story: drilled.story, moving };
    }
    // The larger window: popped out from the panel's space, redrawn with it while open.
    const openTree = (): void => parts.tree()?.show(drilled, selected);
    panel.querySelector("[data-open-tree]")?.addEventListener("click", openTree);
    if (parts.tree()?.open === true) openTree();
    panel.querySelector(".panel-close")?.addEventListener("click", () => parts.deselect());
  };

  return {
    show,
    choose(capability) {
      chosen = capability;
      show();
    },
    stop() {
      card?.();
      card = undefined;
    },
  };
}

