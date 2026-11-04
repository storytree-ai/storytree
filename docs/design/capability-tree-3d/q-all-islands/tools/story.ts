/** Rollout 1: the story whose island the page draws, `?story=<id>`; The library by default (the island every round so far
 * was tuned on). */
export const LIBRARY = "story_754e87e7d531";
export const STORY = (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("story")) ?? LIBRARY;
