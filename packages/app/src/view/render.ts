/** Capability 3 · Surfaces. The app story's controls; the desktop frame only mounts them. */
import { markSvg, type MarkRoles } from "@storytree/mark/drawing";
import type { FactoryPlace } from "../projects/selection.js";
import { MENU_TABS } from "../surfaces/named.js";

/** The mark's roles on the page (its drawing only: the page cannot load the package's file writers): the page's stylesheet sets these from its own light or dark colours (contract 2.11). */
const PAGE_MARK: MarkRoles = { ocean: "var(--mark-ocean)", land: "var(--mark-land)", tree: "var(--mark-tree)", leaf: "var(--mark-leaf)" };

export function renderAppMenu(): string {
  return `<header class="app-bar"><div class="app-factory" data-app-factory><div data-app-switcher></div><p class="app-project-error" data-app-project-error role="alert" hidden></p></div><button type="button" class="app-gear" aria-label="App menu" popovertarget="app-menu" aria-controls="app-menu" aria-expanded="false" title="App menu">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9.5 3-.6 2.3-1.7 1L5 5.7 2.5 10l1.7 1.7v2L2.5 15.4 5 19.7l2.2-.6 1.7 1 .6 2.3h5l.6-2.3 1.7-1 2.2.6 2.5-4.3-1.7-1.7v-2l1.7-1.7L19 5.7l-2.2.6-1.7-1L14.5 3z" transform="translate(0 -1)"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg>
  </button></header>
  <div id="app-menu" popover="auto" class="app-menu" role="dialog" aria-modal="true" aria-label="App menu">
    <div class="app-menu-window">
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
          <section id="app-updates" data-surface-id="menu:updates" aria-labelledby="app-updates-title" hidden><h2 id="app-updates-title" tabindex="-1">Updates</h2><p class="app-section-description">Keep storytree up to date.</p><button type="button" data-app-updates aria-describedby="app-update-status">Check for updates</button><div id="app-update-status" class="app-update-status" role="status" aria-live="polite" aria-atomic="true" hidden></div><fieldset class="app-install-choice" data-app-install-choice hidden><legend>When updates install</legend><label><input type="radio" name="app-install-mode" value="quiet"><span><strong>When no one is using it</strong><span>Once the window and your agents have been idle for ten minutes.</span></span></label><label><input type="radio" name="app-install-mode" value="hours"><span><strong>Only during quiet hours</strong><span class="app-install-hours"><input type="time" data-app-install-from aria-label="Quiet hours start" value="01:00"> to <input type="time" data-app-install-to aria-label="Quiet hours end" value="06:00"></span></span></label><label><input type="radio" name="app-install-mode" value="manual"><span><strong>Only when I choose</strong><span>Nothing installs until you press Check for updates, then Restart to update.</span></span></label><p class="app-install-next" data-app-install-next></p><p class="app-install-error" data-app-install-error role="alert" hidden></p></fieldset><label class="app-sign-in" data-app-sign-in hidden><input type="checkbox"><span><strong>Open at sign-in</strong><span>storytree opens in the tray when you sign in, so it keeps itself and your agents’ hooks up to date.</span><span class="app-sign-in-error" role="alert" hidden></span></span></label></section>
          <section id="app-help" data-surface-id="menu:help" aria-label="Help" hidden><div data-app-help></div></section>
        </div>
      </div>
    </div>
  </div>`;
}

/** The page when the library has no projects at all: how a user starts their first project. */
export function renderNoProjects(): string {
  return [
    `<div class="empty" data-surface-id="no-projects">`,
    markSvg(PAGE_MARK).trim().replace("<svg ", `<svg class="app-mark" aria-hidden="true" `),
    `<h1>No projects yet</h1>`,
    `<p>This app shows the projects in storytree 0.3's local library, and it has none yet.</p>`,
    `<p>Add a folder as a project with New project… in the project list at the top left, or run <code>storytree doctor --set-up &lt;name&gt;</code> in the folder.</p>`,
    `<p>Your project will appear here automatically.</p>`,
    `</div>`,
  ].join("\n");
}

/**
 * The app bar's project dropdown (in place of ADR-1048 D2's factory switch, owner-directed 2026-10-21): every project, the one
 * on show selected, the user's factory marked as theirs so it stays one choice away, and a last "New project…" that adds one.
 * Values and visible names are both escaped.
 */
export function renderProjectPicker(projects: readonly string[], current: string | undefined, factory: string | undefined): string {
  const options = projects
    .map((name) => `<option value="${escape(name)}"${name === current ? " selected" : ""}${name === factory ? " data-app-factory-option" : ""}>${escape(name)}${name === factory ? " · your factory" : ""}</option>`)
    .join("");
  return `<div class="app-project"><select id="project" aria-label="Project">${options}<option value="" data-app-new-project>New project…</option></select></div>`;
}

/** The factory among the projects, from where the project on show sits (ADR-1040): its own factory, or itself. */
export function factoryOf(place: FactoryPlace | undefined, current: string | undefined): string | undefined {
  if (place?.place === "product") return place.factory;
  if (place?.place === "factory") return current;
  return undefined;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
