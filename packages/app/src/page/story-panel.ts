/**
 * Capability 2 · Storytree projects. The desktop page's story panel (the forest's capability 4 drill-down, mounted by the app): the
 * library's card for a selected note, or the selected story's drill-down with the capability picked on the island shown below
 * its lead (ADR-0659 D2). Every drawing is handed to the forest's folds, which open again the kinds the user opened.
 */
import { selectedCapability, type StoryPanel } from "@storytree/forest";

export interface StoryPanelParts {
  /** The selected story node (`data-selected`) and note (`data-note`) live on this body's dataset. */
  body: HTMLElement;
  /** The drill-down for `story` as the project now reads, or none. */
  drill(story: string): StoryPanel | undefined;
  /** `gate`, when one was picked on the map: the pair of capabilities it joins, whose edges the panel lists. */
  render(drilled: StoryPanel, selected: string | undefined, gate: readonly [string, string] | undefined): string;
  /** Hand the panel just drawn to its folds, which open again the kinds the user keeps open. */
  folds(panel: HTMLElement): void;
  /** Mount the library's card for the selected note; returns its stop. */
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  /** Select nothing on the forest, as a click on empty space would. */
  deselect(): void;
}

export interface StoryPanelView {
  /** Draw the panel for the selection on the body, or hide it. */
  show(): void;
  /** Show `capability` below the open story's sentences (undefined for the story's first), or the edges of the `gate` picked on the map. */
  choose(capability: string | undefined, gate?: readonly [string, string]): void;
  stop(): void;
}

export function storyPanel(panel: HTMLElement, parts: StoryPanelParts): StoryPanelView {
  /** The capability shown below the open story's sentences: the one picked on the island, or the one the panel opened on, so it holds while the project redraws. */
  let chosen: string | undefined;
  /** The gate picked on the map, which the panel shows until another pick (ADR-1282 D1). */
  let gate: readonly [string, string] | undefined;
  let card: (() => void) | undefined;

  const show = (): void => {
    if (parts.body.dataset.note !== undefined) {
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
      panel.replaceChildren();
      return;
    }
    const selected = selectedCapability(drilled, chosen);
    chosen = selected;
    panel.innerHTML = parts.render(drilled, selected, gate);
    parts.folds(panel);
    panel.querySelector(".panel-close")?.addEventListener("click", () => parts.deselect());
  };

  return {
    show,
    choose(capability, picked) {
      chosen = capability;
      gate = picked;
      show();
    },
    stop() {
      card?.();
      card = undefined;
    },
  };
}

