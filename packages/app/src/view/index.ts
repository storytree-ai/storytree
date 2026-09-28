import { mountSettings, type SettingsBridge } from "@storytree/agent-link/view";
import type { ProjectSelection } from "../projects/selection.js";
import { renderAppMenu, renderSwitcher } from "./render.js";
import { appMenuStyles } from "./styles.js";
import { mountUpdates } from "./updates.js";
import type { UpdateAction, UpdateState } from "../updates/main-updates.js";

/** A nonmodal menu; the browser handles click, Escape, outside dismissal and return focus. */
export function mountAppMenu(host: HTMLElement, options: {
  chooseProject(name: string): Promise<void>;
  onChosen(): void | Promise<void>;
  onError(error: unknown): void;
  mountHelp(host: HTMLElement, returnFocus: HTMLElement): { stop(): void };
  checkForUpdates(action: UpdateAction): Promise<UpdateState>;
}) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(appMenuStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  host.classList.add("app-menu-mount");
  host.innerHTML = renderAppMenu();
  const gear = host.querySelector<HTMLButtonElement>(".app-gear")!;
  const menu = host.querySelector<HTMLElement>("#app-menu")!;
  const switcher = menu.querySelector<HTMLElement>("[data-app-switcher]")!;
  const helpHost = menu.querySelector<HTMLElement>("[data-app-help]")!;
  const help = options.mountHelp(helpHost, gear);
  const settingsHost = menu.querySelector<HTMLElement>("[data-app-settings]")!;
  const desktop = host.ownerDocument.defaultView as (Window & { storytree: SettingsBridge }) | null;
  const settings = mountSettings(settingsHost, {
    readSettings: () => desktop!.storytree.readSettings(),
    saveSetting: (name, values) => desktop!.storytree.saveSetting(name, values),
  }, { returnFocus: gear });
  // Dismiss the popover before opening the modal, so its focus return cannot steal dialog focus.
  settingsHost.addEventListener("click", () => menu.hidePopover(), { capture: true });
  const updates = mountUpdates(menu, options.checkForUpdates);
  const expanded = (event: ToggleEvent) => {
    gear.setAttribute("aria-expanded", String(event.newState === "open"));
    // A busy update disables its button, which can leave focus on the page. Restore the
    // opener on dismissal without stealing focus from another control clicked outside.
    if (event.newState === "closed" && document.activeElement === document.body) gear.focus();
  };
  menu.addEventListener("beforetoggle", expanded);
  // Help owns its separate panel. Its mount returns focus to the gear when that panel closes.
  helpHost.addEventListener("click", () => menu.hidePopover());

  return {
    update({ projects, current }: ProjectSelection): void {
      switcher.innerHTML = projects.length === 0 ? '<p class="app-no-projects">No projects yet</p>' : renderSwitcher(projects, current);
      const select = switcher.querySelector<HTMLSelectElement>("select");
      if (select === null) return;
      if (!projects.includes(current ?? "")) select.selectedIndex = -1;
      select.addEventListener("change", () => {
        select.disabled = true;
        void options.chooseProject(select.value).then(async () => {
          menu.hidePopover();
          gear.focus();
          await options.onChosen();
        }).catch(options.onError).finally(() => { select.disabled = false; });
      });
    },
    stop(): void {
      updates.stop();
      help.stop();
      settings.stop();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
      menu.removeEventListener("beforetoggle", expanded);
      host.replaceChildren();
      host.classList.remove("app-menu-mount");
    },
  };
}
