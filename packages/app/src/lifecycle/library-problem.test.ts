/**
 * Capability 1 · Lifecycle, contract 1.45: what the app says when its library cannot be opened, with local-postgres's
 * own refusal for a data folder another program holds.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DataDirInUseError } from "@storytree/local-postgres";

import { libraryProblem } from "./open-where-set.js";

test("1.45 a library another program holds names that program, its process and what to do; any other failure says why it could not be opened", () => {
  assert.equal(
    libraryProblem(new DataDirInUseError("/home/u/.storytree/0.3/pgdata", 4242, "storytree 0.3 (dev)")),
    "The app's library (/home/u/.storytree/0.3/pgdata) is in use by storytree 0.3 (dev) (process 4242). Close that, then open the app again.",
  );
  assert.equal(
    libraryProblem(new DataDirInUseError("/data", 7)),
    "The app's library (/data) is in use by another program (process 7). Close that, then open the app again.",
    "an owner that never said who it was is another program",
  );
  assert.equal(libraryProblem(new Error("connection refused")), "The app's library could not be opened: connection refused");
  assert.equal(libraryProblem("timed out"), "The app's library could not be opened: timed out");
});
