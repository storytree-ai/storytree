/** The app story's controls; the desktop frame only mounts them. */
export function renderAppMenu(): string {
  return `<button type="button" class="app-gear" aria-label="App menu" popovertarget="app-menu" aria-controls="app-menu" aria-expanded="false" title="App menu">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9.5 3-.6 2.3-1.7 1L5 5.7 2.5 10l1.7 1.7v2L2.5 15.4 5 19.7l2.2-.6 1.7 1 .6 2.3h5l.6-2.3 1.7-1 2.2.6 2.5-4.3-1.7-1.7v-2l1.7-1.7L19 5.7l-2.2.6-1.7-1L14.5 3z" transform="translate(0 -1)"/>
      <circle cx="12" cy="12" r="3.2"/>
    </svg>
  </button>
  <section id="app-menu" class="app-menu" popover="auto" aria-label="App menu">
    <div data-app-switcher></div>
    <div class="app-menu-actions">
      <div data-app-help></div>
      <button type="button" data-app-updates aria-describedby="app-update-status">Check for updates</button>
      <div id="app-update-status" class="app-update-status" role="status" aria-live="polite" aria-atomic="true" hidden></div>
      <div data-app-settings></div>
    </div>
  </section>`;
}

/** Every project, with the one on show selected. Values and visible names are both escaped. */
export function renderSwitcher(projects: readonly string[], current: string | undefined): string {
  const options = projects
    .map((name) => `<option value="${escape(name)}"${name === current ? " selected" : ""}>${escape(name)}</option>`)
    .join("");
  return `<label class="app-project">Project <select id="project" autofocus>${options}</select></label>`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
