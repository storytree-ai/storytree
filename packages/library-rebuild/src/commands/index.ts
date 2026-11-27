// Capability 17 · The library's commands
import { ADR_FAMILY } from "../knowledge/decisions/index.js";
import { FYI_FAMILY } from "../work/inbox/index.js";
import type { LibraryVerbContext } from "./context.js";
import type { VerbFamily } from "./kit/index.js";
import { LIBRARY_FAMILY } from "./library/index.js";
import { MEDIA_FAMILY } from "./media-verbs.js";

export { attachMedia, bytesOf, media, MEDIA_LIMIT, mediaFile, sha256Of, type AttachedMedia, type MediaEntry, type MediaFile, type NewMedia } from "./media.js";
export { mediaGuidance } from "./media-verbs.js";
export type { LibraryVerbContext } from "./context.js";
export { narrowedSaid } from "./ranked.js";
export { contextIn, librariesNamed, libraryNamed, PROJECT_INPUT, PROJECTS_INPUT, unopenedSaid } from "./kit/index.js";
export { justificationSaid, NOTE_TOOLS, supersededLines, wholeRecord, type Found, type HeldClaim, type NoteRead, type NoteToolContext, type Presenter } from "../knowledge/notes/index.js";
export { everyHolding, holdingLines, type PhraseHit } from "../knowledge/search/index.js";
export { bareSaid } from "../plan/index.js";
export { editPlanRecord, heldPending, heldSaid, holdPlanChange, refuseHeldPlanWrite } from "../work/arcs/index.js";

export const LIBRARY_FAMILIES: readonly VerbFamily<LibraryVerbContext>[] = [LIBRARY_FAMILY, ADR_FAMILY, FYI_FAMILY, MEDIA_FAMILY];
