/**
 * The project's tree the forest last drew, kept in the page's storage so the next start draws it at
 * once, marked as not yet fresh, while the first read crosses the network. The forest owns its key
 * and judges the shape, so a tree kept by an older build is not drawn.
 */
import { pageKept, type Kept, type PageStorage } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasNode = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && typeof value.id === "string" && typeof value.title === "string" && isObject(value.health);

function isAnnotatedTree(value: unknown): value is AnnotatedTree {
  return isObject(value) && Array.isArray(value.arcs) && Array.isArray(value.stories)
    && value.stories.every((story) => hasNode(story) && Array.isArray(story.capabilities)
      && story.capabilities.every((capability) => hasNode(capability) && Array.isArray(capability.dependsOn) && Array.isArray(capability.contracts)));
}

/** Project `project`'s kept tree; `storage` is the page's own unless handed one. */
export function keptTree(project: string, storage?: PageStorage | null): Kept<AnnotatedTree> {
  const key = `storytree.forest.tree.v1:${project}`;
  return storage === undefined ? pageKept(key, isAnnotatedTree) : pageKept(key, isAnnotatedTree, storage);
}
