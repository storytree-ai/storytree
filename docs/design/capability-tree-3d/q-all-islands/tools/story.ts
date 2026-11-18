export const LIBRARY = "story_754e87e7d531";
export const STORY = (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("story")) ?? LIBRARY;
