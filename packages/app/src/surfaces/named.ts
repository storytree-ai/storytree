// Capability 3 · Surfaces
export const MENU_TABS = ["Projects", "Sessions", "Sharing", "Library", "Surfaces", "Updates", "Help"] as const;

export const appNamedSurfaces = [
  ...MENU_TABS.map((label) => ({ id: `menu:${label.toLowerCase()}`, name: `App menu: ${label}` })),
  { id: "no-projects", name: "No projects yet" },
  { id: "app-message", name: "A message in place of the project" },
];
