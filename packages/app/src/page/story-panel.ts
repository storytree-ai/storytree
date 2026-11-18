// Capability 2 · Storytree projects
import type { StoryPanel } from "@storytree/forest";

export interface StoryPanelParts {
  body: HTMLElement;
  drill(story: string): StoryPanel | undefined;
  render(drilled: StoryPanel, selected: string | undefined, gate: readonly [string, string] | undefined): string;
  store(address: string): string | undefined;
  folds(panel: HTMLElement): void;
  libraryCard(panel: HTMLElement, onClose: () => void): () => void;
  deselect(): void;
  openIncrement(id: string): void;
}

export interface StoryPanelView {
  show(): void;
  choose(capability: string | undefined, gate?: readonly [string, string]): void;
  stop(): void;
}

const handleKey = (handle: Element): string | undefined => {
  const kind = (handle.parentElement as HTMLElement | null)?.dataset.fold;
  if (kind === undefined) return undefined;
  return kind === "contract" ? `contract:${handle.closest<HTMLElement>("[data-contract-id]")?.dataset.contractId ?? ""}` : kind;
};

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
  let chosen: string | undefined;
  let gate: readonly [string, string] | undefined;
  let card: (() => void) | undefined;
  let drawn: { html: string; story: string } | undefined;

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
    if (drawn !== undefined && drawn.story === story && drawn.html === html) return;
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

