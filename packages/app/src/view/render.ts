// Capability 3 · Surfaces
import { markSvg, type MarkRoles } from "@storytree/mark/drawing";
import { ACTIONS } from "@storytree/shown-words";
import type { FactoryPlace } from "../projects/selection.js";
import { MENU_TABS } from "../surfaces/named.js";

const PAGE_MARK: MarkRoles = { edge: "var(--mark-edge)", sheet: "var(--mark-sheet)", tree: "var(--mark-tree)", leaf: "var(--mark-leaf)" };

export function renderAppMenu(): string {
  return `<header class="app-bar"><div class="app-factory" data-app-factory><div data-app-switcher></div><p class="app-project-error" data-app-project-error role="alert" hidden></p></div><button type="button" class="app-gear" aria-label="App menu" popovertarget="app-menu" aria-controls="app-menu" aria-expanded="false" title="App menu">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9.5 3-.6 2.3-1.7 1L5 5.7 2.5 10l1.7 1.7v2L2.5 15.4 5 19.7l2.2-.6 1.7 1 .6 2.3h5l.6-2.3 1.7-1 2.2.6 2.5-4.3-1.7-1.7v-2l1.7-1.7L19 5.7l-2.2.6-1.7-1L14.5 3z" transform="translate(0 -1)"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg>
  </button></header>
  <div id="app-menu" popover="auto" class="app-menu" role="dialog" aria-modal="true" aria-label="App menu">
    <div class="app-menu-window"><button type="button" class="app-update-ready" data-app-update-ready hidden></button>
      <div class="app-menu-body">
        <nav class="app-menu-sections" aria-label="App sections">
          ${MENU_TABS.map((label) => `<button type="button" data-app-section="${label.toLowerCase()}" aria-controls="app-${label.toLowerCase()}" aria-pressed="${label === "Projects"}">${label}</button>`).join("")}
          <button type="button" class="app-menu-close" data-app-close aria-label="Close app menu">Close <span aria-hidden="true">×</span></button>
        </nav>
        <div class="app-menu-content">
          <section id="app-projects" data-surface-id="menu:projects" aria-labelledby="app-projects-title"><h2 id="app-projects-title" tabindex="-1">Projects</h2><p class="app-section-description">Add, describe or remove projects, and choose your factory. The project on show is chosen in the bar above.</p><div data-app-add-project></div><div data-app-project-sentence></div><div data-app-remove-project></div><div data-app-delete-project></div><div data-app-factory></div></section>
          <section id="app-sessions" data-surface-id="menu:sessions" aria-label="Sessions" hidden><div data-app-settings="sessions"></div><div data-app-decision-rights></div></section>
          <section id="app-sharing" data-surface-id="menu:sharing" aria-label="Sharing" hidden><div data-app-journey></div></section>
          <section id="app-library" data-surface-id="menu:library" aria-label="Library" hidden><div data-app-settings="library"></div></section>
          <section id="app-surfaces" data-surface-id="menu:surfaces" aria-label="Surfaces" hidden><div data-app-surfaces></div></section>
          <section id="app-updates" data-surface-id="menu:updates" aria-labelledby="app-updates-title" hidden><h2 id="app-updates-title" tabindex="-1">Updates</h2><p class="app-section-description">Keep storytree up to date. <span data-app-running-build hidden></span></p><button type="button" data-app-updates aria-describedby="app-update-status">Check for updates</button><div id="app-update-status" class="app-update-status" role="status" aria-live="polite" aria-atomic="true" hidden></div><fieldset class="app-install-choice" data-app-install-choice hidden><legend>When updates install</legend><label><input type="radio" name="app-install-mode" value="quiet"><span><strong>When no one is using it</strong><span>Once the window and your agents have been idle for ten minutes.</span></span></label><label><input type="radio" name="app-install-mode" value="hours"><span><strong>Only during quiet hours</strong><span class="app-install-hours"><input type="time" data-app-install-from aria-label="Quiet hours start" value="01:00"> to <input type="time" data-app-install-to aria-label="Quiet hours end" value="06:00"></span></span></label><label><input type="radio" name="app-install-mode" value="manual"><span><strong>Only when I choose</strong><span>Nothing installs until you press Check for updates, then Restart to update.</span></span></label><p class="app-install-next" data-app-install-next></p><p class="app-install-error" data-app-install-error role="alert" hidden></p></fieldset><fieldset class="app-install-choice" data-app-release-channel hidden><legend>Update channel</legend><label><input type="radio" name="app-release-channel" value="stable"><span><strong>Stable</strong><span>Releases that have been tried before they are offered. Recommended.</span><span data-app-stable-build hidden></span></span></label><label><input type="radio" name="app-release-channel" value="alpha"><span><strong>Alpha</strong><span>Opt in to every new release as soon as it is published, before it is tried. Moving back to stable keeps this build until stable passes it.</span></span></label><p class="app-install-next">A change applies at the next check for updates.</p><p class="app-install-error" data-app-release-channel-error role="alert" hidden></p></fieldset><label class="app-sign-in" data-app-sign-in hidden><input type="checkbox"><span><strong>Open at sign-in</strong><span>storytree opens in the tray when you sign in, so it keeps itself and your agents’ hooks up to date.</span><span class="app-sign-in-error" role="alert" hidden></span></span></label></section>
          <section id="app-help" data-surface-id="menu:help" aria-label="Help" hidden><div data-app-help></div></section>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderNoProjects(): string {
  return [
    `<div class="empty" data-surface-id="no-projects">`,
    markSvg(PAGE_MARK).trim().replace("<svg ", `<svg class="app-mark" aria-hidden="true" `),
    `<h1>No projects yet</h1>`,
    `<p>This app shows the projects in your storytree library, and it has none yet.</p>`,
    `<p>Add a folder as a project with ${ACTIONS.addProject} in the project list at the top left, or run <code>storytree doctor --set-up &lt;name&gt;</code> in the folder.</p>`,
    `<p>Your project will appear here automatically.</p>`,
    `</div>`,
  ].join("\n");
}

export function renderProjectPicker(projects: readonly string[], current: string | undefined, factory: string | undefined): string {
  const inFactory = factory !== undefined && current === factory;
  const label = factory === undefined ? "No factory yet" : "Software factory";
  const factoryTab = `<button type="button" class="app-tab app-factory-tab" data-app-factory-tab aria-label="Software factory" title="${label}"${factory === undefined ? ` aria-disabled="true"` : ""}${inFactory ? ` aria-current="true"` : ""}>${FACTORY_ICON}</button>`;
  const options = projects
    .filter((name) => name !== factory)
    .map((name) => `<option value="${escape(name)}"${name === current ? " selected" : ""}>${escape(name)}</option>`)
    .join("");
  const projectsTab = `<div class="app-tab app-project" data-app-projects-tab${inFactory ? "" : ` aria-current="true"`}><select id="project" aria-label="Projects"><button type="button">Projects</button>${options}<option value="" data-app-new-project>${ACTIONS.addProject}</option></select></div>`;
  const name = current === undefined || inFactory ? "" : `<span class="app-project-name" data-app-project-name>${escape(current)}</span><button type="button" class="app-copy-project" data-app-copy-project aria-label="Copy the project's name" title="Copy name">${COPY_ICON}</button>`;
  return `<nav class="app-switch" aria-label="Factory and projects">${factoryTab}${projectsTab}${name}</nav>`;
}

export const COPY_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6" fill="none" stroke="currentColor"/></svg>`;

const FACTORY_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20V11l5-3v3l5-3v3l5-3V4h3v16z"/><path d="M7 16h2m3 0h2"/></svg>`;

export function factoryOf(place: FactoryPlace | undefined, current: string | undefined): string | undefined {
  if (place?.place === "product") return place.factory;
  if (place?.place === "factory") return current;
  return undefined;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
