/**
 * Capability 2 · Storytree projects. The desktop page's story panel (the forest's capability 4 drill-down, mounted by the app): the
 * library's card for a selected note, a selected shared store's panel, or the selected story's drill-down, on the capability picked when one is, never one picked
 * for the user (ADR-1297). A drawing that changes the panel is handed to the forest's folds, which open again the kinds the user opened.
 */
import type { StoryPanel } from "@storytree/forest";

export interface StoryPanelParts {
  /** The selected story node (`data-selected`) and note (`data-note`) live on this body's dataset. */
  body: HTMLElement;
  /** The drill-down for `story` as the project now reads, or none. */
  drill(story: string): StoryPanel | undefined;
  /** `gate`, when one was picked on the map: the pair of capabilities it joins, whose edges the panel lists. */
  render(drilled: StoryPanel, selected: string | undefined, gate: readonly [string, string] | undefined): string;
  /** The panel of the shared store at `address` (`data-store`), or none when no store there was read. */
  store(address: string): string | undefined;
  /** Hand the panel just drawn to its folds, which open again the kinds the user keeps open. */
  folds(panel: HTMLElement): void;
  /** Mount the library's card for the selected note; returns its stop. */
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  /** Select nothing on the forest, as a click on empty space would. */
  deselect(): void;
  /** Show increment `id` where the frame shows one: the rail's Arcs tab (2.57). */
  openIncrement(id: string): void;
}

export interface StoryPanelView {
  /** Draw the panel for the selection on the body, or hide it. */
  show(): void;
  /** Show `capability` of the open story (undefined for the story alone), or the edges of the `gate` picked on the map. */
  choose(capability: string | undefined, gate?: readonly [string, string]): void;
  stop(): void;
}

/** A handle's identity across a rebuild: its fold's kind, and for a contract's own fold, the contract it sits in. */
const handleKey = (handle: Element): string | undefined => {
  const kind = (handle.parentElement as HTMLElement | null)?.dataset.fold;
  if (kind === undefined) return undefined;
  return kind === "contract" ? `contract:${handle.closest<HTMLElement>("[data-contract-id]")?.dataset.contractId ?? ""}` : kind;
};

/** What the user has open on the panel now: the contracts' own folds, the handle in focus and the scroll position. */
function snapshot(panel: HTMLElement): { contracts: string[]; focus: string | undefined; scroll: number } {
  const contracts = [...panel.querySelectorAll<HTMLElement>('.panel-fold[data-fold="contract"] > .panel-handle[aria-expanded="true"]')].map((h) => handleKey(h)!);
  const active = panel.ownerDocument.activeElement;
  const focus = active !== null && panel.contains(active) && active.classList.contains("panel-handle") ? handleKey(active) : undefined;
  return { contracts, focus, scroll: panel.scrollTop };
}

function restore(panel: HTMLElement, kept: ReturnType<typeof snapshot>): void {
  const handles = [...panel.querySelectorAll<HTMLElement>(".panel-handle")];
  for (const handle of handles) {
    const key = handleKey(handle);
    if (key === undefined || !kept.contracts.includes(key)) continue;
    const body = handle.nextElementSibling as HTMLElement | null;
    handle.setAttribute("aria-expanded", "true");
    if (body !== null) body.hidden = false;
  }
  if (kept.focus !== undefined) handles.find((handle) => handleKey(handle) === kept.focus)?.focus();
  panel.scrollTop = kept.scroll;
}

export function storyPanel(panel: HTMLElement, parts: StoryPanelParts): StoryPanelView {
  /** The capability picked, on the island or by its name on the panel, held while the project redraws. */
  let chosen: string | undefined;
  /** The gate picked on the map, which the panel shows until another pick (ADR-1282 D1). */
  let gate: readonly [string, string] | undefined;
  let card: (() => void) | undefined;
  /** The HTML on the panel now and the story it was drawn for: news that renders the same changes nothing on screen. */
  let drawn: { html: string; story: string } | undefined;

  // An open-work row's button opens its increment (forest 4.48, 2.57).
  const onClick = (event: Event): void => {
    const id = (event.target as Element).closest?.<HTMLElement>("[data-open-increment]")?.dataset.openIncrement;
    if (id !== undefined) parts.openIncrement(id);
  };
  panel.addEventListener("click", onClick);

  const show = (): void => {
    if (parts.body.dataset.note !== undefined) {
      panel.hidden = false;
      card ??= parts.libraryCard(panel, () => parts.deselect());
      drawn = undefined;
      return;
    }
    card?.();
    card = undefined;
    const address = parts.body.dataset.store;
    if (address !== undefined) {
      const html = parts.store(address);
      panel.hidden = html === undefined;
      if (html === undefined) panel.replaceChildren();
      else if (drawn?.story !== `store:${address}` || drawn.html !== html) {
        panel.innerHTML = html;
        panel.querySelector(".panel-close")?.addEventListener("click", () => parts.deselect());
      }
      drawn = html === undefined ? undefined : { html, story: `store:${address}` };
      return;
    }
    const story = parts.body.dataset.selected;
    const drilled = story === undefined ? undefined : parts.drill(story);
    panel.hidden = drilled === undefined;
    if (drilled === undefined) {
      panel.replaceChildren();
      drawn = undefined;
      return;
    }
    const html = parts.render(drilled, chosen, gate);
    // The same story drawn the same: nothing to change, so nothing is touched (ADR-0836 D1).
    if (drawn !== undefined && drawn.story === story && drawn.html === html) return;
    // A change on the same story keeps what the user opened (a contract's own fold too), the handle in focus and the scroll.
    const kept = drawn?.story === story ? snapshot(panel) : undefined;
    panel.innerHTML = html;
    drawn = { html, story: story! };
    parts.folds(panel);
    if (kept !== undefined) restore(panel, kept);
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
      panel.removeEventListener("click", onClick);
    },
  };
}

