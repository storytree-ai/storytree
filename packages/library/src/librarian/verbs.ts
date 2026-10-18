/**
 * Capability 25 · Queues. The librarian's command families, which the package's manifest names under `verbs`
 * (ADR-1033), each at its place among `storytree`'s families: `friction` 13th and `resteer` 14th. The `adr` family is
 * the library core's (commands/adr.ts, ADR-1077 D2).
 */
import type { VerbFamily } from "../verbs/verb.js";

import { FRICTION_VERBS, RESTEER_VERBS } from "./queues/verbs.js";

export const LIBRARIAN_FAMILIES: readonly VerbFamily[] = [
  { name: "friction", summary: "file friction with its evidence, add a recurrence, or drain and route it", order: 13, verbs: FRICTION_VERBS },
  { name: "resteer", summary: "file a re-steer, with the owner's own words", order: 14, verbs: RESTEER_VERBS },
];
