// Capability 17 · The library's commands
import type { LibraryVerbContext } from "../context.js";
import type { VerbFamily } from "../kit/index.js";
import { EDIT } from "./edit.js";
import { HISTORY, LIST, MOVE_TO_EDGES, REVERT, UNDO } from "./history.js";
import { LINKS, READ, RELATED } from "./read.js";
import { EXACT, PHRASE, SEARCH } from "./search.js";
import { NEW, REFILE, RETIRE } from "./write.js";

export const LIBRARY_FAMILY: VerbFamily<LibraryVerbContext> = {
  name: "library",
  summary: "search, read, write, edit, refile, retire, list and revert the library's records",
  order: 1,
  verbs: [SEARCH, PHRASE, EXACT, LINKS, RELATED, NEW, READ, EDIT, REFILE, RETIRE, LIST, HISTORY, REVERT, UNDO, MOVE_TO_EDGES],
};
