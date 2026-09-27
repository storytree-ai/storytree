/**
 * Capability 3 · Library: one test per contract in stories/cli.md, each running the real, built
 * `storytree` command. Contracts 3.1 (read), 3.2 (edit) and 3.4 (history) wait on the library's
 * `get`, `list` and `history` on its public API (0-3-library-writer-and-public-reads), and are
 * written when those land.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("3.3 `new` without a required field is refused, naming it", async () => {
  await inWorld(command, async (world) => {
    const ran = await world.run(["library", "new", "story", "--description", "Visitors can sign up"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /\btitle\b/);
    assert.deepEqual((await (await world.library()).changesSince(0)).changes, []);
  });
});
