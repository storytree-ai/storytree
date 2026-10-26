/**
 * Capability 7 · Library API: contract 7.20, through the package's light entry `@storytree/library/printable`,
 * the way the command line and the status line reach it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { printable } from "@storytree/library/printable";

test("7.20 · printable keeps text, line breaks and tabs, and turns every other control character into a placeholder", () => {
  const title = "Mailer\u001b]52;c;aGk=\u0007 done";
  assert.equal(printable(title), "Mailer�]52;c;aGk=� done");
  assert.equal(printable("a\tb\nc\r\nd · ⚠ é"), "a\tb\nc\r\nd · ⚠ é");
  assert.equal(printable("x\ry\u0000z\u007f\u009b31m"), "x�y�z��31m");
});
