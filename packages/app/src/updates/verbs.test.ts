/** Capability 4 · Updates, contract 4.16, as the declared `release pin` reads the owner's words at whichever door mounts it. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { commandInput, commandUsage, VerbRefusal } from "@storytree/project-and-caller/verbs";

import { RELEASE_FAMILIES } from "./verbs.js";

function given(words: readonly string[], flags: Readonly<Record<string, string>> = {}) {
  return { word: (index: number) => words[index], flag: (name: string) => flags[name], flags: (name: string) => name in flags ? [flags[name]!] : [], has: (name: string) => name in flags, names: () => Object.keys(flags) };
}

test("4.16 the declared `release pin` refuses a missing version and a stray word as misuses, before its act could publish anything", () => {
  const [release] = RELEASE_FAMILIES;
  assert.equal(release!.name, "release");
  const pin = release!.verbs.find((each) => "name" in each.command && each.command.name === "pin")!;
  assert.equal(commandUsage(pin), "release pin <0.3.n> [--preview]");
  assert.throws(() => commandInput(pin, given([])), (error) => error instanceof VerbRefusal && error.misuse && error.message === "this needs <version>: the owner's chosen release");
  assert.throws(() => commandInput(pin, given(["0.3.9", "0.3.10"])), (error) => error instanceof VerbRefusal && error.misuse && error.message === "this takes one word, and was given 2");
  assert.deepEqual(commandInput(pin, given(["0.3.9"], { preview: "" })), { version: "0.3.9", preview: true });
});
