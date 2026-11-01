/** Capability 2 · Storytree projects: the gear menu and its overlay. */
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

/** The app owns the bars' top edge and overlay frame; each story mounts its own content. */
export function mountAppMenu(host: HTMLElement, options: {
  background: HTMLElement;
  chooseProject(name: string): Promise<void>;
  onChosen(): void | Promise<void>;
  onError(error: unknown): void;
  mountHelp(host: HTMLElement, returnFocus: HTMLElement, onOpen: () => void): { open(): void; close(): void; stop(): void };
  checkForUpdates: UpdatesBridge["checkForUpdates"];
  /** Opening at sign-in, where the frame can offer it (lifecycle 1.12). */
  signIn?: SignInBridge;
  /** When a downloaded release may install itself, where the app installs releases (updates 4.13). */
  installChoice?: InstallChoiceBridge;
  /** Which release channel the app follows, where it installs releases (updates 4.24). */
  releaseChannel?: ReleaseChannelBridge;
  /** The app setup's Add project control; it reports the project added, which is then shown. `add` starts it from the bar's "New project…". */
  mountAddProject?(host: HTMLElement, onAdded: (project: string) => Promise<void>): { stop(): void; add(): void };
  /** The app setup's project sentence for the project on show: what it is and who it is for, edited in place (ADR-1085 D1 as narrowed). */
  mountProjectSentence?(host: HTMLElement, current: () => string | undefined): { stop(): void; refresh(): void };
  /** The app setup's Your factory: the factory folder in use, imported or switched with no approval (question_0b0b82eb8fbc). */
  mountFactory?(host: HTMLElement): { stop(): void };
  /** The app setup's Remove project control: offers the project on show; once removed, the frame refreshes the list. */
  mountRemoveProject?(host: HTMLElement, current: () => string | undefined, onRemoved: (project: string) => Promise<void>): { stop(): void; refresh(): void };
  /** The app setup's Delete a project control: offers every project but the one on show; once deleted, the frame refreshes the list. */
  mountDeleteProject?(host: HTMLElement, onDeleted: (project: string) => Promise<void>): { stop(): void; refresh(): void };
  /** A story-owned sharing settings surface; the frame only gives it a section. */
  mountJourney?(host: HTMLElement): { open(): void; close(): void; stop(): void };
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
  const switcher = host.querySelector<HTMLElement>("[data-app-switcher]")!;
  const projectError = host.querySelector<HTMLElement>("[data-app-project-error]")!;
  let switcherDrawn = "";
  const desktop = host.ownerDocument.defaultView as (Window & { storytree: SettingsBridge & SurfacesBridge & { standingDelegations(name: string): Promise<string | undefined> } }) | null;
  const bridge: SettingsBridge = {
    readSettings: () => desktop!.storytree.readSettings(),
    saveSetting: (name, values) => desktop!.storytree.saveSetting(name, values),
  };
  // Session management offers its settings by group; each group is its own tab.
  const sessionSettings = mountSettings(menu.querySelector<HTMLElement>('[data-app-settings="sessions"]')!, bridge, { returnFocus: gear, embedded: true, group: "sessions" });
  // Below them, who decides what (Session management 7.6), with the standing delegations of the project on show.
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
  const updates = mountUpdates(menu, options.checkForUpdates, (waiting) => {
    gear.toggleAttribute("data-update-pending", waiting);
    gear.title = waiting ? "App menu: an update is ready to install" : "App menu";
  }, installChoice.choice);
  const releaseChannel = mountReleaseChannel(menu, options.releaseChannel);
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
    update({ projects, current, factory: place }: ProjectSelection): void {
      shown = current !== undefined && projects.includes(current) ? current : undefined;
      projectSentence?.refresh();
      removeProject?.refresh();
      deleteProject?.refresh();
      // The bar's tabs: the factory's icon switches straight to it, and Projects lists the products, "New project…" opening
      // the gear's Projects to add one. Drawn again only when they change, so a poll does not close a picker the user has open.
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
      // The product on show's name goes to the clipboard as plain text, acknowledged on its button.
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
