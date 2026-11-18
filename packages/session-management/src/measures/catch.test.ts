// Capability 20 · Lane measures
import assert from "node:assert/strict";
import { test } from "node:test";

import { CATCH_LAYERS, layerOfDrill, layerOfField, layerOfFinding } from "./catch.js";
import { MEASURES_FAMILIES } from "./verbs.js";

const NAMES = ["test writer", "builder", "lint", "build-loop check", "mutation report", "test reviewer", "code reviewer", "CI", "escaped"];

test("20.4 · the catch layers are the nine, earliest to latest, each with its own definition; every drill layer, a field pattern's caughtAt and the QA ledger's found_by (by slice) map onto them, a reviewer's hit on a whole review onto none", () => {
  assert.deepEqual(CATCH_LAYERS.map((layer) => layer.name), NAMES, "the fixed order, from test writer to escaped");
  for (const layer of CATCH_LAYERS) assert.match(layer.means, /\w/, `${layer.name} says what it means`);
  assert.equal(new Set(CATCH_LAYERS.map((layer) => layer.means.trim())).size, NAMES.length, "each layer is defined once, in its own words");

  const drill = {
    "test-writer": "test writer", builder: "builder", lint: "lint", tests: "build-loop check", mutation: "mutation report",
    "test-reviewer": "test reviewer", "code-reviewer": "code reviewer", "ci-linux": "CI", "ci-windows": "CI", none: "escaped",
  } as const;
  for (const [layer, name] of Object.entries(drill)) assert.equal(layerOfDrill(layer as keyof typeof drill), name, `a drill's ${layer} is ${name}`);

  assert.equal(layerOfField("ci"), "CI");
  assert.equal(layerOfField("escaped"), "escaped");

  for (const [foundBy, slice, name] of [
    ["graduated", "code", "lint"],
    ["graduated", "whole", "lint"],
    ["mutation", "test", "mutation report"],
    ["mutation", "whole", "mutation report"],
    ["weakening", "test", "test reviewer"],
    ["weakening", "whole", "test reviewer"],
    ["reviewer", "code", "code reviewer"],
    ["reviewer", "test", "test reviewer"],
    ["reviewer", "whole", undefined],
  ] as const) {
    assert.equal(layerOfFinding(foundBy, slice), name, `found by ${foundBy} on a ${slice} slice is ${name ?? "no layer"}`);
  }
});

test("20.5 · `storytree measures catch` is a verb of the measures family whose help defines every catch layer, in the fixed order, and says it is report only", () => {
  const family = MEASURES_FAMILIES.find((one) => one.name === "measures")!;
  const verb = family.verbs.find((one) => "name" in one.command && one.command.name === "catch");
  assert.ok(verb, "the measures family has a catch verb");
  assert.ok("summary" in verb.command);
  const help = verb.command.summary;
  assert.match(help, /report only/);
  let after = -1;
  for (const layer of CATCH_LAYERS) {
    const at = help.indexOf(layer.means);
    assert.ok(at > after, `the help defines ${layer.name} (${layer.means}) after the layer before it`);
    after = at;
  }
});
