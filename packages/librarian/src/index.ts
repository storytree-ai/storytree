// @storytree/librarian: keeps a project's library honest as a library (stories/librarian.md). It
// reaches the library only through the library's public API and holds no data of its own.
export { link, unrestedDecisions } from "./links/index.js";
export { annotate, brokenEdges, correct, supersede } from "./decision-log/index.js";
export type { Annotation, BrokenEdge, Correction, Successor } from "./decision-log/index.js";
export { newNotes, retire } from "./catalogue/index.js";
export type { NewNote } from "./catalogue/index.js";
export { LibrarianRefusal } from "./notes.js";
export type { Reference } from "./notes.js";
