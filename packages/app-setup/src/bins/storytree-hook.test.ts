/** Capability 8 · Setup check: contract 8.25, the file-to-capability lookup the hook command setup registers gives the gate before each edit. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { declaredCapabilities } from "./storytree-hook.js";

test("8.25 the hook command setup registers places an edited file in its capability by the map's rule: its opening \"Capability N · …\", or a test file's one numbered capability, and never by the survey's inference", async () => {
  const tree = { arcs: [], stories: [{ id: "story_1", title: "Visitor can sign up", capabilities: [{ id: "cap_form", title: "1 · Email form" }, { id: "cap_reset", title: "2 · Password reset" }] }] } as unknown as AnnotatedTree;
  const src = "packages/visitor-can-sign-up/src";
  const texts: Record<string, string> = {
    [`${src}/form.ts`]: "/**\n * Capability 1 · Email form: the form.\n */\nexport const form = 1;\n",
    [`${src}/reset.test.ts`]: 'import { test } from "node:test";\ntest("2.1 a reset link is sent", () => {});\n',
    [`${src}/notes.ts`]: 'import { form } from "./form.js";\nexport const notes = form;\n',
    "packages/elsewhere/src/other.ts": "/**\n * Capability 1 · Email form\n */\n",
  };
  const placed = await declaredCapabilities("/nowhere", Object.keys(texts), tree, (file) => texts[file]!);
  assert.deepEqual(Object.fromEntries(placed), { [`${src}/form.ts`]: "cap_form", [`${src}/reset.test.ts`]: "cap_reset" });
});
