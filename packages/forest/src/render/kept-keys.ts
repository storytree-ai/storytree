/**
 * Capability 3 · Story node render. Where the page keeps the forest it last drew: a key per project under each prefix, the tree and
 * what it was drawn with. Named here, with nothing imported, so the lag catalogue can say which keys a start without a kept forest
 * forgets (3.42) without loading the page's storage.
 */
export const KEPT_TREE_KEY = "storytree.forest.tree.v1:";
export const KEPT_DRAWING_KEY = "storytree.forest.drawing.v1:";
