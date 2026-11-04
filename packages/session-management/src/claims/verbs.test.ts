/**
 * Capability 5 · Claims. The workspace verbs' wording of a refused claim or workspace, as the command line's
 * `workspace` family, mounted from this package's manifest, answers it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { workspaceRefusalText } from "./verbs.js";

test("5.35 the command line's wording of a refused claim names the increments its holder holds the work for", () => {
  const holder = { capability: "capability_form", session: "s1", label: "Codex", reason: "build form", since: "2026-10-10T00:00:00.000Z", holder: "live" } as const;
  const refused = workspaceRefusalText("capability_form", { ok: false, refused: "held", holder, heldFor: ["increment_form", "increment_mail"] });
  assert.ok(refused.includes("Codex session s1 for increment_form, increment_mail: build form"), refused);
  assert.doesNotMatch(workspaceRefusalText("capability_form", { ok: false, refused: "held", holder, heldFor: [] }), /session s1 for |closes/);
  const increment = workspaceRefusalText("increment_form", { ok: false, refused: "held", holder: { ...holder, capability: undefined, increment: "increment_form" }, heldFor: ["increment_form"] });
  assert.ok(increment.includes("once increment_form closes"), increment);
});

test("5.64 the command line's wording of a refused capability, held directly or on a held increment's list, says to wait on its claim, which clears when its holder releases it; a refused increment's does not", () => {
  const holder = { capability: "capability_form", session: "s1", label: "Codex", reason: "build form", since: "2026-10-10T00:00:00.000Z", holder: "live" } as const;
  const waitOn = (capability: string) => `storytree arc increment wait <increment> --on ${capability} --reason …), which clears the moment its holder releases it`;
  for (const heldFor of [[], ["increment_form"]]) {
    const direct = workspaceRefusalText("capability_form", { ok: false, refused: "held", holder, heldFor });
    assert.ok(direct.includes(waitOn("capability_form")), direct);
    assert.doesNotMatch(direct, /closes/);
  }
  const listed = workspaceRefusalText("increment_speed", { ok: false, refused: "held", listed: "capability_surface", holder: { ...holder, capability: undefined, increment: "increment_tab" }, heldFor: ["increment_tab"] });
  assert.ok(listed.includes(waitOn("capability_surface")), listed);
  const increment = workspaceRefusalText("increment_form", { ok: false, refused: "held", holder: { ...holder, capability: undefined, increment: "increment_form" }, heldFor: ["increment_form"] });
  assert.doesNotMatch(increment, /wait on its claim/);
});

test("5.25 the command line's wording of a refused workspace offers --despite-open-pulls from the refusal's pull data regardless of its wording", () => {
  const increment = "increment_email";
  const why = "Finish pull request #41 on claude/email first";
  const refused = workspaceRefusalText(increment, {
    ok: false,
    refused: "no-workspace",
    why,
    openPulls: [{ number: 41, branch: "claude/email" }],
  });
  assert.ok(refused.includes(why), refused);
  assert.ok(refused.includes(`storytree workspace ${increment} --reason <text> --despite-open-pulls`), refused);
  assert.doesNotMatch(workspaceRefusalText(increment, {
    ok: false,
    refused: "no-workspace",
    why: "Cannot check whether this work already has open pull requests",
  }), /--despite-open-pulls/);
});
