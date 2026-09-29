/**
 * The forest story's surfaces, as the app's Surfaces menu lists them (ADR-0750): each with its plain
 * name, one line on what it is, whether it can be switched off, and its own settings. Plain data, so
 * the app, the desktop frame and the command line can all read it without a browser.
 */
export const forestSurfaces = [
  {
    id: "globe",
    name: "Forest globe",
    description: "The planet of your project: one island per story, where you pick a story to open.",
    switchable: false,
    settings: [],
  },
  {
    id: "library",
    name: "Library",
    description: "The Library view, which lets you see through the globe to your project's notes, and the Library panel that shows the note you pick. Off, the globe stays solid and its Forest and Library buttons go.",
    switchable: true,
    settings: [],
  },
  {
    id: "story-panel",
    name: "Story panel",
    description: "The panel that opens beside the globe when you pick a story, with the story's name and what it is for.",
    switchable: false,
    settings: [],
  },
  {
    id: "capability-tree",
    within: "story-panel",
    name: "Capability tree",
    description: "The story's capabilities as a tree you can move and zoom, in the panel and in its larger window.",
    switchable: true,
    settings: [],
  },
  {
    id: "capability-details",
    within: "story-panel",
    follows: "capability-tree",
    name: "Capability details",
    description: "The capability you pick in the tree, with its health and its contracts. It is picked in the tree, so it goes off with it.",
    switchable: false,
    settings: [],
  },
  {
    id: "sessions",
    name: "Sessions",
    description: "The agent sessions at work: their list, their wisps circling the islands they hold, and the islands they light when you point at one.",
    switchable: true,
    settings: [],
  },
] as const;
