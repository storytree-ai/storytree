/**
 * Capability 3 · Story node render. The forest story's surfaces, as the app's Surfaces menu lists them (ADR-0750): each with its plain
 * name, one line on what it is, whether it can be switched off, and its own settings. Plain data, so
 * the app, the desktop frame and the command line can all read it without a browser.
 */

/** The globe's opening views: how much of the window's short side the planet fills. */
export const GLOBE_OPENINGS = [
  { id: "whole-planet", name: "Whole planet" },
  { id: "close", name: "Close up" },
  { id: "far", name: "With room around" },
] as const;
export type GlobeOpening = (typeof GLOBE_OPENINGS)[number]["id"];

/** The capability tree's opening views, in the panel and in its larger window alike. */
export const TREE_OPENINGS = [
  { id: "whole-tree", name: "Whole tree" },
  { id: "full-size", name: "Full size" },
  { id: "close", name: "Close up" },
] as const;
export type TreeOpening = (typeof TREE_OPENINGS)[number]["id"];

export const forestSurfaces = [
  {
    id: "globe",
    name: "Forest globe",
    description: "The planet of your project: one island per story, where you pick a story to open.",
    switchable: false,
    settings: [{
      id: "opening-zoom",
      name: "Opening zoom",
      meaning: "How close the globe opens: the whole planet (most of the window), close up, or with room around it.",
      default: "whole-planet",
      choices: GLOBE_OPENINGS,
    }],
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
    settings: [{
      id: "opening-zoom",
      name: "Opening zoom",
      meaning: "How the tree opens, in the panel and in its larger window: the whole tree fitted (never above full size nor below 30%), full size, or close up, from its top.",
      default: "whole-tree",
      choices: TREE_OPENINGS,
    }],
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
    description: "The agent sessions at work: their list, the territories they claimed, outlined in their colours, and the islands they light when you point at one.",
    switchable: true,
    settings: [],
  },
] as const;
