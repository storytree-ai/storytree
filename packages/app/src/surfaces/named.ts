/**
 * Capability 3 · Surfaces. The canvases the app's frame opens that are not the Surfaces menu's switches, as Surface feedback
 * names them: each gear menu tab, and what the page shows in place of a project.
 */
export const MENU_TABS = ["Projects", "Sessions", "Sharing", "Library", "Surfaces", "Updates", "Help"] as const;

export const appNamedSurfaces = [
  ...MENU_TABS.map((label) => ({ id: `menu:${label.toLowerCase()}`, name: `App menu: ${label}` })),
  { id: "no-projects", name: "No projects yet" },
  { id: "app-message", name: "A message in place of the project" },
];
