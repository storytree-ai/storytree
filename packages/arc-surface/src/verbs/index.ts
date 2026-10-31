/**
 * Capability 3 · Arc surface. The arc surface's command families, which the package's manifest names under `verbs`
 * (ADR-1033), each at its place among `storytree`'s families: `arc` 2nd, with `arc increment` within it, and `question`
 * 3rd. Its section of the habits card (ADR-1021, the guidance kind) teaches the one of them that is a tool.
 */
import type { VerbFamily } from "@storytree/library/verbs";

import { ARC_GUESSES, ARC_INNER, ARC_VERBS } from "./arcs.js";
import type { ArcVerbContext } from "./context.js";
import { QUESTION_GUESSES, QUESTION_VERBS } from "./questions.js";

export type { ArcVerbContext } from "./context.js";

export const ARC_FAMILIES: readonly VerbFamily<ArcVerbContext>[] = [
  { name: "arc", summary: "arcs, and the increments of their work", order: 2, verbs: ARC_VERBS, families: ARC_INNER, guesses: ARC_GUESSES },
  { name: "question", summary: "the owner's questions: raise, show, present, settle, retire, move, list, check, renew", order: 3, verbs: QUESTION_VERBS, guesses: QUESTION_GUESSES },
];

/** Its section of the habits card: the arc verb an agent calls as a tool (apply-pending, ADR-0966). */
export const arcGuidance: readonly string[] = [
  "`apply_pending` applies pending plan changes a merged pull request left unapplied.",
];
