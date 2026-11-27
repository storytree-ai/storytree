// Capability 17 · The library's commands
import type { Verb, VerbInputs } from "../../../commands/kit/index.js";
import type { NoteToolContext } from "./context.js";
import { OPEN } from "./open.js";
import { FIND_TEXT, SEARCH_NOTES } from "./search.js";
import { CORRECT_NOTE, WRITE_NOTE } from "./write.js";

export { searchKinds } from "./search.js";
export type { Found, HeldClaim, NoteRead, NoteToolContext, Presenter } from "./context.js";

export const NOTE_TOOLS: readonly Verb<VerbInputs, NoteToolContext>[] = [SEARCH_NOTES, FIND_TEXT, OPEN, WRITE_NOTE, CORRECT_NOTE];
