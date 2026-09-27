/** Capability 1: story text stays in the library but is not drawn as a knowledge artifact. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isStoryText } from "@storytree/knowledge-core";
import type { RecordEnvelope } from "@storytree/library";

test("1.7 isStoryText recognizes only definitions whose term or title starts with the stored story-text prefix", () => {
  const record = (type: string, fields: Record<string, unknown>): RecordEnvelope => ({
    id: "example", type, version: 1, fields, createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(isStoryText(record("definition", { term: "Story text: stories/forest.md" })), true);
  assert.equal(isStoryText(record("definition", { title: "Story text: stories/knowledge-core.md" })), true);
  assert.equal(isStoryText(record("definition", { term: "A shelf", title: "Story text: stories/forest.md" })), true);
  assert.equal(isStoryText(record("definition", { term: "A shelf", definition: "The entrance into a story's knowledge." })), false);
  assert.equal(isStoryText(record("definition", { term: "Story text: other/forest.md" })), false);
  assert.equal(isStoryText(record("definition", { term: "About Story text: stories/forest.md" })), false);
  assert.equal(isStoryText(record("definition", { term: 123, title: null })), false);
  assert.equal(isStoryText(record("principle", { title: "Story text: stories/forest.md" })), false);
  assert.equal(isStoryText(record("decision", { title: "Story text: stories/forest.md", status: "accepted" })), false);
});
