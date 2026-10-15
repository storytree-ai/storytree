import assert from "node:assert/strict";
import { test } from "node:test";

import { cardOf, KINDS } from "./cards.js";

test("1.1 · every kind has a card with a title and a line at once, and what, why, how and its decisions for More", () => {
  assert.deepEqual([...KINDS], ["empty", "arc", "story", "capability", "claim", "health", "decision", "question"]);
  for (const kind of KINDS) {
    const card = cardOf(kind);
    assert.equal(card.kind, kind);
    for (const field of ["title", "line", "what", "why", "how"] as const) assert.ok(card[field].length > 0, `${kind} has its ${field}`);
    for (const decision of card.decisions) assert.ok(decision.number > 0 && decision.title.length > 0, `${kind}'s decision is numbered and named`);
  }
  // The empty map's card says it fills as the user's agent builds (ADR-1048 D1).
  assert.match(cardOf("empty").line, /fills as your agent builds/);
});
