// Capability 1 · The reading. @storytree/reading-the-front-doors: the story Reading the front doors (ADR-0998, ADR-0983 D7). How the command line and
// the tool server are used, read on demand from their own door-answered lines: the reading (capability 1) and the
// printed table (capability 2). Nothing here recurs, flags or writes; a front door asks for a reading and prints it.
export { countDoors } from "./reading.js";
export type { Consumer, Declared, DeclaredVerb, Door, DoorLine, Failure, Follow, Miss, Reading, Split, Surface, Window } from "./reading.js";
export { readDoors } from "./read.js";
export { STEPS, stepOf, type Step } from "./steps.js";
export { doorsJson, doorsTable } from "./table.js";
