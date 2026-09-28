/**
 * The capability tree's own space (the forest story, capability 4; ADR-0743): a large layer over
 * the forest, beside the story panel, popped out from the tree's space inside the panel, where the
 * tree is moved and zoomed (`attachPanZoom`). It opens with the whole tree fitted in it, as its
 * "Fit" control puts it back, and keeps where it was while the live reading redraws the same story.
 * Its legend names the cards' four words (ADR-0744). Clicking a card chooses it as the panel's does.
 */
import type { StoryPanel } from "@storytree/forest";

import { attachPanZoom } from "./pan-zoom.js";
import { renderTree } from "./story-panel.js";

export interface TreeSpace {
  /** Open the space on `panel`, or redraw it, with `selected` marked. */
  show(panel: StoryPanel, selected: string | undefined): void;
  close(): void;
  readonly open: boolean;
  stop(): void;
}

export function mountTreeSpace(host: HTMLElement, on: { choose(id: string): void; closed(): void }): TreeSpace {
  const space = document.createElement("section");
  space.className = "tree-space";
  space.hidden = true;
  space.setAttribute("aria-label", "Capability tree");
  space.innerHTML = `
    <header class="tree-space-head">
      <h2></h2>
      <span class="tree-space-legend">
        <span class="status-proposed">proposed</span><span class="status-healthy">healthy</span><span class="status-unhealthy">unhealthy</span><span class="status-untested">untested</span>
      </span>
      <button type="button" class="tree-space-fit">Fit</button>
      <button type="button" class="tree-space-close" aria-label="Close the capability tree">×</button>
    </header>
    <div class="tree-space-frame">
      <div class="tree-space-surface"></div>
      <p class="tree-space-hint">Drag to move · scroll or pinch to zoom</p>
    </div>`;
  host.append(space);
  const heading = space.querySelector("h2") as HTMLHeadingElement;
  const frame = space.querySelector(".tree-space-frame") as HTMLDivElement;
  const surface = space.querySelector(".tree-space-surface") as HTMLDivElement;

  let story: string | undefined;
  const moving = attachPanZoom(frame, surface, (id) => on.choose(id));

  const close = (): void => {
    if (space.hidden) return;
    space.hidden = true;
    story = undefined;
    on.closed();
  };
  space.querySelector(".tree-space-close")?.addEventListener("click", close);
  space.querySelector(".tree-space-fit")?.addEventListener("click", () => moving.fit());
  // Escape closes the space before it reaches the forest, which would close the panel too.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || space.hidden) return;
    event.stopPropagation();
    close();
  };
  window.addEventListener("keydown", onKey, { capture: true });

  return {
    show(panel, selected) {
      const focused = document.activeElement?.matches("[data-capability-id]") === true && space.contains(document.activeElement);
      heading.textContent = `${panel.title}: capability tree`;
      surface.innerHTML = renderTree(panel, selected, "tree-space-diagram");
      const opening = space.hidden || story !== panel.story;
      space.hidden = false;
      story = panel.story;
      if (opening) moving.fit();
      else moving.place(moving.view);
      if (focused) surface.querySelector<SVGGElement>(".selected")?.focus({ preventScroll: true });
    },
    close,
    get open() {
      return !space.hidden;
    },
    stop() {
      window.removeEventListener("keydown", onKey, { capture: true });
      moving.stop();
      space.remove();
    },
  };
}
