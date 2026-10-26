/**
 * Capability 4 · Work model, contract 4.23: a pull request number resolves through the project's repository cut-over
 * by when it was recorded (increment_7f7599b35fe4).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { pullRepository, pullSaid, type PrCutover } from "./index.js";

const HOME = "storytree-ai/storytree";
const cutover: PrCutover = { at: "2026-11-02T09:00:00.000Z", repository: HOME, before: "storytree-ai/storytree-history" };

test("4.23 · a pull request recorded before the repository cut-over is the old repository's and one recorded on or after it the new one's; a deleted old repository is none; with no cut-over every number is the project's repository's", () => {
  assert.equal(pullRepository(cutover, "#1738", "2026-10-23", HOME), "storytree-ai/storytree-history", "a closure dated before the cut-over");
  assert.equal(pullRepository(cutover, "12", "2026-11-03", HOME), "storytree-ai/storytree", "a closure dated after it");
  assert.equal(pullRepository(cutover, "#3", "2026-11-02", HOME), "storytree-ai/storytree", "a closure on the cut-over's own day is the new repository's");
  assert.equal(pullRepository(cutover, "#1850", "2026-11-02T08:59:00.000Z", HOME), "storytree-ai/storytree-history", "a time just before it is the old one's");
  assert.equal(pullRepository(cutover, "https://github.com/storytree-ai/storytree/pull/131", "2026-10-01", HOME), "storytree-ai/storytree-history", "an address naming the moved name follows the move");
  assert.equal(pullRepository(cutover, "other/tool#7", "2026-10-01", HOME), "other/tool", "another repository's stays its own");
  assert.equal(pullRepository(undefined, "#1738", "2026-10-23", HOME), "storytree-ai/storytree", "no cut-over");
  assert.equal(pullRepository(cutover, "no pull request", "2026-10-23", HOME), undefined);

  assert.equal(pullSaid(cutover, "#1738", "2026-10-23"), "storytree-ai/storytree-history#1738");
  assert.equal(pullSaid(cutover, "12", "2026-11-03"), "#12");
  assert.equal(pullSaid(undefined, "storytree-ai/storytree#131", "2026-10-23"), "#131");

  const deleted: PrCutover = { ...cutover, before: null };
  assert.equal(pullRepository(deleted, "#1738", "2026-10-23", HOME), null, "its repository is gone");
  assert.equal(pullSaid(deleted, "#1738", "2026-10-23"), "#1738, in a deleted repository");
  assert.equal(pullRepository(deleted, "#12", "2026-11-03", HOME), "storytree-ai/storytree");
});
