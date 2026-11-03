/**
 * Capability 2 · Storytree projects. The page's left rail (ADR-1219): one full-height column down the window's left, under the
 * app bar, with a tab for each of the sessions list and the arcs that is switched on, Sessions then Arcs. One tab shows at a
 * time; the one chosen is kept per project in the page's storage, and a project with none kept opens on Arcs, where the owner
 * plans. The Arcs tab carries a badge of what waits on him there, which the arc surface tells it. The rail is the frame's: each
 * story mounts its own surface in its tab's panel.
 */

export type RailTab = "sessions" | "arcs";

const NAMES: Readonly<Record<RailTab, string>> = { sessions: "Sessions", arcs: "Arcs" };
const key = (project: string) => `storytree.app.rail-tab.v1:${project}`;

export interface Rail {
  /** The panel a tab's surface mounts in. */
  panel(tab: RailTab): HTMLElement;
  /** What waits on the owner in the arcs; none hides the badge. */
  badge(count: number): void;
  stop(): void;
}

/** Mounts the rail at the start of `content` with `tabs` in the rail's order; with none it mounts nothing. */
export function mountRail(content: HTMLElement, options: { project: string; tabs: readonly RailTab[]; storage?: Pick<Storage, "getItem" | "setItem"> }): Rail | undefined {
  const tabs = (["sessions", "arcs"] as const).filter((tab) => options.tabs.includes(tab));
  if (tabs.length === 0) return undefined;
  const document = content.ownerDocument;
  const storage = options.storage ?? document.defaultView?.localStorage;
  const kept = (() => { try { return storage?.getItem(key(options.project)); } catch { return null; } })();
  let shown: RailTab = tabs.find((tab) => tab === kept) ?? (tabs.includes("arcs") ? "arcs" : tabs[0]!);
  const rail = document.createElement("aside");
  rail.className = "side-rail";
  rail.setAttribute("aria-label", "Sessions and arcs");
  rail.dataset.surfaceLayer = "panel";
  rail.innerHTML = `<div class="side-rail-tabs" role="tablist" aria-label="Rail">${tabs.map((tab) =>
    `<button type="button" role="tab" id="rail-tab-${tab}" data-rail-tab="${tab}" aria-controls="rail-${tab}">${NAMES[tab]}${tab === "arcs" ? `<span class="side-rail-badge" data-rail-badge hidden></span>` : ""}</button>`).join("")}</div>`
    + tabs.map((tab) => `<div role="tabpanel" class="side-rail-panel" id="rail-${tab}" aria-labelledby="rail-tab-${tab}"></div>`).join("");
  content.prepend(rail);
  const buttons = [...rail.querySelectorAll<HTMLButtonElement>("[data-rail-tab]")];
  const show = (tab: RailTab): void => {
    shown = tab;
    // The rail is the surface of the tab on show, so the feedback corner names it from the tabs too.
    rail.dataset.surfaceId = tab;
    for (const button of buttons) {
      const on = button.dataset.railTab === tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    for (const panel of rail.querySelectorAll<HTMLElement>("[role=tabpanel]")) panel.hidden = panel.id !== `rail-${tab}`;
  };
  show(shown);
  const choose = (tab: RailTab): void => {
    show(tab);
    try { storage?.setItem(key(options.project), tab); } catch { /* Keep this launch's choice. */ }
  };
  for (const button of buttons) button.addEventListener("click", () => choose(button.dataset.railTab as RailTab));
  // The tabs' arrow keys, as a tab list's: the next or previous tab is chosen and takes the focus.
  rail.querySelector(".side-rail-tabs")!.addEventListener("keydown", (event) => {
    const { key: pressed } = event as KeyboardEvent;
    if (pressed !== "ArrowLeft" && pressed !== "ArrowRight") return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(shown) + (pressed === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    choose(next);
    buttons.find((button) => button.dataset.railTab === next)?.focus();
  });
  const badge = rail.querySelector<HTMLElement>("[data-rail-badge]");
  return {
    panel: (tab) => rail.querySelector<HTMLElement>(`#rail-${tab}`)!,
    badge(count) {
      if (!badge) return;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.title = `${count} waiting on you`;
      buttons.find((button) => button.dataset.railTab === "arcs")?.setAttribute("aria-label", count === 0 ? "Arcs" : `Arcs, ${count} waiting on you`);
    },
    stop() { rail.remove(); },
  };
}
