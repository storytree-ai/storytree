/**
 * Capability 2 · Decision log and capability 5 · Queues. The librarian's command families, which the package's manifest
 * names under `verbs` (ADR-1033), each at its place among `storytree`'s families: `adr` 4th, `friction` 13th and
 * `resteer` 14th.
 */
import type { VerbFamily } from "@storytree/project-and-caller/verbs";

import { ADR_GUESSES, ADR_VERBS } from "./decision-log/verbs.js";
import { FRICTION_VERBS, RESTEER_VERBS } from "./queues/verbs.js";

export const LIBRARIAN_FAMILIES: readonly VerbFamily[] = [
  { name: "adr", summary: "the decision log: new, pull, push, compose, list", order: 4, verbs: ADR_VERBS, guesses: ADR_GUESSES },
  { name: "friction", summary: "file friction with its evidence, add a recurrence, or drain and route it", order: 13, verbs: FRICTION_VERBS },
  { name: "resteer", summary: "file a re-steer, with the owner's own words", order: 14, verbs: RESTEER_VERBS },
];
