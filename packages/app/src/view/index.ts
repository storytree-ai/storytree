import { mountSettings, type SettingsBridge } from "@storytree/agent-link/view";
import type { ProjectSelection } from "../projects/selection.js";
import type { SurfacesBridge } from "../surfaces/bridge.js";
import { renderAppMenu, renderSwitcher } from "./render.js";
import { appMenuStyles } from "./styles.js";
import { mountSurfaces } from "./surfaces.js";
import { mountUpdates } from "./updates.js";
import type { UpdateAction, UpdateState } from "../updates/main-updates.js";

/** The app owns the bars' top edge and overlay frame; each story mounts its own content. */
export function mountAppMenu(host: HTMLElement, options: {
  background: HTMLElement;
  chooseProject(name: string): Promise<void>;
  onChosen(): void | Promise<void>;
  onError(error: unknown): void;
  mountHelp(host: HTMLElement, returnFocus: HTMLElement, onOpen: () => void): { open(): void; close(): void; stop(): void };
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
  /** Hears a surface switched or set in the Surfaces menu, saved already, for the frame to apply. */
  onSurfacesChanged(): void;
}) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(appMenuStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  host.classList.add("app-menu-mount");
  host.innerHTML = renderAppMenu();
  const gear = host.querySelector<HTMLButtonElement>(".app-gear")!;
  const menu = host.querySelector<HTMLElement>("#app-menu")!;
  const switcher = menu.querySelector<HTMLElement>("[data-app-switcher]")!;
  const projectError = menu.querySelector<HTMLElement>("[data-app-project-error]")!;
  const desktop = host.ownerDocument.defaultView as (Window & { storytree: SettingsBridge & SurfacesBridge }) | null;
  const settings = mountSettings(menu.querySelector<HTMLElement>("[data-app-settings]")!, {
    readSettings: () => desktop!.storytree.readSettings(),
    saveSetting: (name, values) => desktop!.storytree.saveSetting(name, values),
  }, { returnFocus: gear, embedded: true });
  const surfaces = mountSurfaces(menu.querySelector<HTMLElement>("[data-app-surfaces]")!, {
    readSurfaces: () => desktop!.storytree.readSurfaces(),
    saveSurface: (words) => desktop!.storytree.saveSurface(words),
  }, options.onSurfacesChanged);
  const help = options.mountHelp(menu.querySelector<HTMLElement>("[data-app-help]")!, gear, () => {
    selectSection("help");
    menu.showPopover();
  });
  const updates = mountUpdates(menu, options.checkForUpdates, (waiting) => {
    gear.toggleAttribute("data-update-pending", waiting);
    gear.title = waiting ? "App menu: an update is ready to install" : "App menu";
  });
  let section = "projects";
  let stopped = false;
  const wasInert = options.background.inert;
  function selectSection(next: string): void {
    if (stopped) return;
    if (section !== next) {
      if (section === "settings") { settings.close(); surfaces.close(); }
      if (section === "help") help.close();
    }
    section = next;
    for (const panel of menu.querySelectorAll<HTMLElement>(".app-menu-content > section")) panel.hidden = panel.id !== `app-${next}`;
    for (const button of menu.querySelectorAll<HTMLElement>("[data-app-section]")) button.setAttribute("aria-pressed", String(button.dataset.appSection === next));
    if (next === "settings") { settings.open(); surfaces.open(); }
    else if (next === "help") help.open();
  }
  function close(): void { menu.hidePopover(); }
  const expanded = (event: ToggleEvent) => {
    const open = event.newState === "open";
    gear.setAttribute("aria-expanded", String(open));
    options.background.inert = open || wasInert;
    if (open) selectSection(section);
    else {
      if (section === "settings") { settings.close(); surfaces.close(); }
      if (section === "help") help.close();
      gear.focus();
    }
  };
  menu.addEventListener("beforetoggle", expanded);
  menu.querySelector("[data-app-close]")!.addEventListener("click", close);
  menu.addEventListener("click", (event) => { if (event.target === menu) close(); });
  for (const button of menu.querySelectorAll<HTMLButtonElement>("[data-app-section]")) {
    button.addEventListener("click", () => selectSection(button.dataset.appSection!));
  }
  // Keep the always-visible gear in the focus loop. Escape must not also close the arc drawer.
  const key = (event: KeyboardEvent) => {
    if (!menu.matches(":popover-open")) return;
    if (event.key === "Escape") {
      event.stopImmediatePropagation();
      if (menu.querySelector("select:open")) return; // Let the native picker consume its own Escape.
      event.preventDefault(); close();
    }
    if (event.key !== "Tab") return;
    const controls = [gear, ...menu.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href]")]
      .filter((node) => node.getClientRects().length > 0);
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault(); controls.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault(); gear.focus();
    }
  };
  document.addEventListener("keydown", key, true);

  return {
    update({ projects, current }: ProjectSelection): void {
      switcher.innerHTML = projects.length === 0 ? '<p class="app-no-projects">No projects yet</p>' : renderSwitcher(projects, current);
      const select = switcher.querySelector<HTMLSelectElement>("select");
      if (select === null) return;
      if (!projects.includes(current ?? "")) select.selectedIndex = -1;
      select.addEventListener("change", () => {
        select.disabled = true;
        projectError.hidden = true;
        void options.chooseProject(select.value).then(async () => {
          close();
          gear.focus();
          await options.onChosen();
        }).catch((error: unknown) => {
          projectError.textContent = `Couldn’t switch project: ${error instanceof Error ? error.message : String(error)}`;
          projectError.hidden = false;
          options.onError(error);
        }).finally(() => { select.disabled = false; });
      });
    },
    stop(): void {
      stopped = true;
      updates.stop(); help.stop(); settings.stop(); surfaces.stop();
      options.background.inert = wasInert;
      document.removeEventListener("keydown", key, true);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
      menu.removeEventListener("beforetoggle", expanded);
      host.replaceChildren();
      host.classList.remove("app-menu-mount");
    },
  };
}
