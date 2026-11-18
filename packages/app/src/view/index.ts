// Capability 2 · Storytree projects
import { mountDecisionRights, mountSettings, type SettingsBridge } from "@storytree/project-and-caller/view";
import type { ProjectSelection } from "../projects/selection.js";
import type { SurfacesBridge } from "../surfaces/bridge.js";
import { COPY_ICON, factoryOf, renderAppMenu, renderProjectPicker } from "./render.js";
import { appMenuStyles } from "./styles.js";
import { mountSurfaces } from "./surfaces.js";
import { switchProject } from "./switch.js";
import { mountInstallChoice, mountReleaseChannel, mountSignIn, mountUpdates, type InstallChoiceBridge, type ReleaseChannelBridge, type SignInBridge } from "./updates.js";
import type { UpdatesBridge } from "../updates/bridge.js";

export { renderNoProjects } from "./render.js";

export function mountAppMenu(host: HTMLElement, options: {
  background: HTMLElement;
  chooseProject(name: string): Promise<void>;
  onChosen(): void | Promise<void>;
  onError(error: unknown): void;
  mountHelp(host: HTMLElement, returnFocus: HTMLElement, onOpen: () => void): { open(): void; close(): void; stop(): void };
  checkForUpdates: UpdatesBridge["checkForUpdates"];
  signIn?: SignInBridge;
  installChoice?: InstallChoiceBridge;
  releaseChannel?: ReleaseChannelBridge;
  mountAddProject?(host: HTMLElement, onAdded: (project: string) => Promise<void>): { stop(): void; add(): void };
  mountProjectSentence?(host: HTMLElement, current: () => string | undefined): { stop(): void; refresh(): void };
  mountFactory?(host: HTMLElement): { stop(): void };
  mountRemoveProject?(host: HTMLElement, current: () => string | undefined, onRemoved: (project: string) => Promise<void>): { stop(): void; refresh(): void };
  mountDeleteProject?(host: HTMLElement, onDeleted: (project: string) => Promise<void>): { stop(): void; refresh(): void };
  mountJourney?(host: HTMLElement): { open(): void; close(): void; stop(): void };
  onSurfacesChanged(): void;
}) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(appMenuStyles);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  host.classList.add("app-menu-mount");
  host.innerHTML = renderAppMenu();
  const gear = host.querySelector<HTMLButtonElement>(".app-gear")!;
  const menu = host.querySelector<HTMLElement>("#app-menu")!;
  const switcher = host.querySelector<HTMLElement>("[data-app-switcher]")!;
  const projectError = host.querySelector<HTMLElement>("[data-app-project-error]")!;
  let switcherDrawn = "";
  const desktop = host.ownerDocument.defaultView as (Window & { storytree: SettingsBridge & SurfacesBridge & { standingDelegations(name: string): Promise<string | undefined> } }) | null;
  const bridge: SettingsBridge = {
    readSettings: () => desktop!.storytree.readSettings(),
    saveSetting: (name, values) => desktop!.storytree.saveSetting(name, values),
  };
  const sessionSettings = mountSettings(menu.querySelector<HTMLElement>('[data-app-settings="sessions"]')!, bridge, { returnFocus: gear, embedded: true, group: "sessions" });
  const decisionRights = mountDecisionRights(menu.querySelector<HTMLElement>("[data-app-decision-rights]")!,
    async () => shown === undefined ? undefined : desktop!.storytree.standingDelegations(shown));
  const sessions = {
    open(): void { sessionSettings.open(); decisionRights.open(); },
    close(): void { sessionSettings.close(); decisionRights.close(); },
    stop(): void { sessionSettings.stop(); decisionRights.stop(); },
  };
  const library = mountSettings(menu.querySelector<HTMLElement>('[data-app-settings="library"]')!, bridge, { returnFocus: gear, embedded: true, group: "library" });
  const journey = options.mountJourney?.(menu.querySelector<HTMLElement>("[data-app-journey]")!);
  if (journey === undefined) menu.querySelector<HTMLElement>('[data-app-section="sharing"]')!.hidden = true;
  const surfaces = mountSurfaces(menu.querySelector<HTMLElement>("[data-app-surfaces]")!, {
    readSurfaces: () => desktop!.storytree.readSurfaces(),
    saveSurface: (words) => desktop!.storytree.saveSurface(words),
  }, options.onSurfacesChanged);
  const help = options.mountHelp(menu.querySelector<HTMLElement>("[data-app-help]")!, gear, () => {
    selectSection("help");
    menu.showPopover();
  });
  const addProject = options.mountAddProject?.(menu.querySelector<HTMLElement>("[data-app-add-project]")!, async (project) => {
    await options.chooseProject(project);
    close();
    gear.focus();
    await options.onChosen();
  });
  let shown: string | undefined;
  const projectSentence = options.mountProjectSentence?.(menu.querySelector<HTMLElement>("[data-app-project-sentence]")!, () => shown);
  const removeProject = options.mountRemoveProject?.(menu.querySelector<HTMLElement>("[data-app-remove-project]")!, () => shown, async () => { await options.onChosen(); });
  const deleteProject = options.mountDeleteProject?.(menu.querySelector<HTMLElement>("[data-app-delete-project]")!, async () => { await options.onChosen(); });
  const factory = options.mountFactory?.(menu.querySelector<HTMLElement>("[data-app-factory]")!);
  const installChoice = mountInstallChoice(menu, options.installChoice, undefined, () => updates.refresh());
  const updateReady = menu.querySelector<HTMLButtonElement>("[data-app-update-ready]")!;
  updateReady.addEventListener("click", () => selectSection("updates"));
  let waiting: string | undefined;
  const showReady = () => { updateReady.hidden = waiting === undefined || section === "updates"; };
  const updates = mountUpdates(menu, options.checkForUpdates, (ready) => {
    waiting = ready;
    gear.toggleAttribute("data-update-pending", ready !== undefined);
    gear.title = ready ?? "App menu";
    updateReady.textContent = ready ?? "";
    showReady();
    installChoice.waiting(ready !== undefined);
  }, installChoice.choice, () => releaseChannel.channel());
  const releaseChannel = mountReleaseChannel(menu, options.releaseChannel, () => updates.refresh());
  const signIn = mountSignIn(menu, options.signIn);
  let section = "projects";
  let stopped = false;
  const wasInert = options.background.inert;
  const tabs: Record<string, { open(): void; close(): void }> = { sessions, library, surfaces, help, ...(journey === undefined ? {} : { sharing: journey }) };
  function selectSection(next: string): void {
    if (stopped) return;
    if (section !== next) tabs[section]?.close();
    section = next;
    for (const panel of menu.querySelectorAll<HTMLElement>(".app-menu-content > section")) panel.hidden = panel.id !== `app-${next}`;
    for (const button of menu.querySelectorAll<HTMLElement>("[data-app-section]")) button.setAttribute("aria-pressed", String(button.dataset.appSection === next));
    showReady();
    tabs[next]?.open();
  }
  function close(): void { menu.hidePopover(); }
  const expanded = (event: ToggleEvent) => {
    const open = event.newState === "open";
    gear.setAttribute("aria-expanded", String(open));
    options.background.inert = open || wasInert;
    if (open) selectSection(section);
    else {
      tabs[section]?.close();
      gear.focus();
    }
  };
  menu.addEventListener("beforetoggle", expanded);
  menu.querySelector("[data-app-close]")!.addEventListener("click", close);
  menu.addEventListener("click", (event) => { if (event.target === menu) close(); });
  for (const button of menu.querySelectorAll<HTMLButtonElement>("[data-app-section]")) {
    button.addEventListener("click", () => selectSection(button.dataset.appSection!));
  }
  const key = (event: KeyboardEvent) => {
    if (!menu.matches(":popover-open")) return;
    if (event.key === "Escape") {
      event.stopImmediatePropagation();
      if (menu.querySelector("select:open")) return;
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
    openHelp(): void {
      if (menu.matches(":popover-open")) return;
      selectSection("help");
      menu.showPopover();
    },
    update({ projects, current, factory: place }: ProjectSelection): void {
      shown = current !== undefined && projects.includes(current) ? current : undefined;
      projectSentence?.refresh();
      removeProject?.refresh();
      deleteProject?.refresh();
      const factoryName = factoryOf(place, shown);
      const drawn = renderProjectPicker(projects, shown, factoryName);
      if (switcherDrawn === drawn) return;
      switcherDrawn = drawn;
      switcher.innerHTML = drawn;
      const factoryTab = switcher.querySelector<HTMLButtonElement>("[data-app-factory-tab]")!;
      const select = switcher.querySelector<HTMLSelectElement>("select")!;
      const reset = () => { if (shown === undefined || shown === factoryName) select.selectedIndex = -1; else select.value = shown; };
      reset();
      factoryTab.addEventListener("click", () => {
        if (factoryName !== undefined && factoryName !== shown) show(factoryName);
      });
      const copy = switcher.querySelector<HTMLButtonElement>("[data-app-copy-project]");
      const named = shown;
      copy?.addEventListener("click", () => {
        const say = (text: string) => {
          copy.textContent = text;
          setTimeout(() => { if (copy.isConnected) copy.innerHTML = COPY_ICON; }, 1500);
        };
        void Promise.resolve().then(() => navigator.clipboard.writeText(named!)).then(() => say("Copied"), () => say("Copy failed"));
      });
      select.addEventListener("change", () => {
        if (select.options[select.selectedIndex]?.hasAttribute("data-app-new-project")) {
          projectError.hidden = true;
          reset();
          selectSection("projects");
          if (!menu.matches(":popover-open")) menu.showPopover();
          addProject?.add();
          return;
        }
        show(select.value);
      });
      function show(name: string): void {
        projectError.hidden = true;
        void switchProject(name, {
          choose: options.chooseProject,
          chosen: async () => {
            close();
            await options.onChosen();
          },
          failed: (message, error) => {
            reset();
            projectError.textContent = message;
            projectError.hidden = false;
            options.onError(error);
          },
          busy: (on) => { select.disabled = on; factoryTab.disabled = on; },
        });
      }
    },
    stop(): void {
      stopped = true;
      updates.stop(); journey?.stop(); installChoice.stop(); releaseChannel.stop(); signIn.stop(); help.stop(); sessions.stop(); library.stop(); surfaces.stop(); addProject?.stop(); projectSentence?.stop(); removeProject?.stop(); deleteProject?.stop(); factory?.stop();
      options.background.inert = wasInert;
      document.removeEventListener("keydown", key, true);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
      menu.removeEventListener("beforetoggle", expanded);
      host.replaceChildren();
      host.classList.remove("app-menu-mount");
    },
  };
}
