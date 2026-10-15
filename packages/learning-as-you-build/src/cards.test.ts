import assert from "node:assert/strict";
import { test } from "node:test";

import { cardOf, KINDS } from "./cards.js";

test("1.1 · every kind has a card with a title and a line at once, and what, why, how and its decisions for More", () => {
  assert.deepEqual([...KINDS], ["empty", "arc", "story", "capability", "claim", "health", "decision", "question"]);
  // Each kind says its own thing at every depth: no two kinds share a title, a line, a what, a why or a how.
  for (const field of ["title", "line", "what", "why", "how"] as const) {
    const said = KINDS.map(kind => cardOf(kind)[field].trim());
    assert.ok(said.every(text => text !== ""), `every kind has its ${field}`);
    assert.equal(new Set(said).size, KINDS.length, `each kind's ${field} is its own`);
  }
  for (const kind of KINDS) assert.equal(cardOf(kind).kind, kind);
  // The decisions behind a card: a story is its own package (ADR-0819), and the empty map's rule is ADR-1048.
  assert.ok(cardOf("story").decisions.some(decision => decision.number === 819));
  assert.ok(cardOf("empty").decisions.some(decision => decision.number === 1048));
  // The empty map's card says it fills as the user's agent builds (ADR-1048 D1).
  assert.match(cardOf("empty").line, /fills as your agent builds/);
});
