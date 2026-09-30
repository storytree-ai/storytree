/** The app story's controls; the desktop frame only mounts them. */
export function renderAppMenu(): string {
  return `<header class="app-bar"><button type="button" class="app-gear" aria-label="App menu" popovertarget="app-menu" aria-controls="app-menu" aria-expanded="false" title="App menu">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9.5 3-.6 2.3-1.7 1L5 5.7 2.5 10l1.7 1.7v2L2.5 15.4 5 19.7l2.2-.6 1.7 1 .6 2.3h5l.6-2.3 1.7-1 2.2.6 2.5-4.3-1.7-1.7v-2l1.7-1.7L19 5.7l-2.2.6-1.7-1L14.5 3z" transform="translate(0 -1)"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg>
  </button></header>
  <div id="app-menu" popover="auto" class="app-menu" role="dialog" aria-modal="true" aria-label="App menu">
    <div class="app-menu-window">
      <div class="app-menu-body">
        <nav class="app-menu-sections" aria-label="App sections">
          ${["Projects", "Sessions", "Library", "Surfaces", "Updates", "Help"].map((label) => `<button type="button" data-app-section="${label.toLowerCase()}" aria-controls="app-${label.toLowerCase()}" aria-pressed="${label === "Projects"}">${label}</button>`).join("")}
          <button type="button" class="app-menu-close" data-app-close aria-label="Close app menu">Close <span aria-hidden="true">×</span></button>
        </nav>
        <div class="app-menu-content">
          <section id="app-projects" aria-labelledby="app-projects-title"><h2 id="app-projects-title" tabindex="-1">Projects</h2><p class="app-section-description">Choose the project to show in the forest, or add a folder as a new one.</p><div data-app-switcher></div><p class="app-project-error" data-app-project-error role="alert" hidden></p><div data-app-add-project></div><div data-app-remove-project></div></section>
          <section id="app-sessions" aria-label="Sessions" hidden><div data-app-settings="sessions"></div></section>
          <section id="app-library" aria-label="Library" hidden><div data-app-settings="library"></div></section>
          <section id="app-surfaces" aria-label="Surfaces" hidden><div data-app-surfaces></div></section>
          <section id="app-updates" aria-labelledby="app-updates-title" hidden><h2 id="app-updates-title" tabindex="-1">Updates</h2><p class="app-section-description">Keep storytree up to date.</p><button type="button" data-app-updates aria-describedby="app-update-status">Check for updates</button><div id="app-update-status" class="app-update-status" role="status" aria-live="polite" aria-atomic="true" hidden></div><label class="app-sign-in" data-app-sign-in hidden><input type="checkbox"><span><strong>Open at sign-in</strong><span>storytree opens in the tray when you sign in, so it keeps itself and your agents’ hooks up to date.</span><span class="app-sign-in-error" role="alert" hidden></span></span></label></section>
          <section id="app-help" aria-label="Help" hidden><div data-app-help></div></section>
        </div>
      </div>
    </div>
  </div>`;
}

/** Every project, with the one on show selected. Values and visible names are both escaped. */
export function renderSwitcher(projects: readonly string[], current: string | undefined): string {
  const options = projects
    .map((name) => `<option value="${escape(name)}"${name === current ? " selected" : ""}>${escape(name)}</option>`)
    .join("");
  return `<label class="app-project">Project <select id="project">${options}</select></label>`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
