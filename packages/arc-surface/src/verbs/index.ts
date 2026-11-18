// Capability 3 · Arc surface.
import type { VerbFamily } from "@storytree/library/verbs";

import { ARC_GUESSES, ARC_INNER, ARC_VERBS } from "./arcs.js";
import type { ArcVerbContext } from "./context.js";
import { QUESTION_GUESSES, QUESTION_VERBS } from "./questions.js";

export { ARC_SIZE_LIMIT, oversizedSaid } from "./arc-size.js";
export type { ArcVerbContext } from "./context.js";

export const ARC_FAMILIES: readonly VerbFamily<ArcVerbContext>[] = [
  { name: "arc", summary: "arcs, and the increments of their work", order: 2, verbs: ARC_VERBS, families: ARC_INNER, guesses: ARC_GUESSES },
  { name: "question", summary: "the owner's questions: raise, show, present, settle, retire, move, list, check, renew", order: 3, verbs: QUESTION_VERBS, guesses: QUESTION_GUESSES },
];

export const arcGuidance: readonly string[] = [
  "`apply_pending` applies pending plan changes a merged pull request left unapplied.",
];
