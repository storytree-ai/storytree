// Capability 4 · Updates
import assert from "node:assert/strict";
import { test } from "node:test";

import { mounted } from "@storytree/library/verbs";

import { RELEASE_FAMILIES } from "./verbs.js";

test("4.16 the declared `release pin` is the command line's alone: pinning stable is the owner's own act, and no agent is offered a tool for it", () => {
  const [release] = RELEASE_FAMILIES;
  assert.equal(release!.name, "release");
  const pin = release!.verbs.find((each) => mounted(each.command) && each.command.name === "pin")!;
  assert.equal(mounted(pin.tool), false);
});
