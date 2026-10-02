/** Capability 1 · Front door, contract 1.13: shell-joined id lists get a usable refusal before writing. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

for (const flag of ["links", "touches", "stories"] as const) {
  test(`1.13 --${flag} refuses shell-joined ids with a quoted retry before writing, and keeps valid ids`, async () => {
    await inWorld(command, async (world) => {
      const library = await world.library();
      const stories = await Promise.all(["Sign up", "Sign in"].map((title) => library.addStory({ title })));
      const capabilities = await Promise.all(stories.map((story) => library.addCapability({ story: story.id, title: "Form" })));
      const decisions = await Promise.all(["Mailer", "Hosting"].map((title) => library.recordDecision({ title, text: "Use the service", status: "proposed" })));
      const arc = await library.createArc({ title: "Launch", intent: "Ship the site", endState: "The site is live" });
      const ids = (flag === "links" ? decisions : flag === "touches" ? capabilities : stories).map(({ id }) => id);
      const args = flag === "links"
        ? ["adr", "new", "--title", "Launch choices", "--text", "Use these services", "--status", "proposed"]
        : flag === "touches"
          ? ["arc", "increment", "new", "--arc", arc.id, "--title", "Forms", "--objective", "People can enter", "--body", "Build both forms"]
          : ["arc", "new", "--title", "Entry", "--intent", "People can enter", "--end-state", "Both forms work"];

      // This is the single argv word PowerShell produces from the unquoted comma list.
      const before = (await library.changesSince(0)).cursor;
      const refused = await world.run([...args, `--${flag}`, ids.join(" ")]);
      assert.notEqual(refused.code, 0, refused.stdout);
      assert.deepEqual((await library.changesSince(before)).changes, [], "the refusal must precede every write");
      assert.match(refused.stderr, /PowerShell/);
      assert.match(refused.stderr, /array/);
      assert.ok(refused.stderr.includes(`--${flag} "id1,id2"`), refused.stderr);

      // Quotes belong to the caller's shell; the command receives the comma-separated word.
      const accepted = await world.run([...args, `--${flag}`, ` ${ids.join(", ")} `]);
      assert.equal(accepted.code, 0, accepted.stderr);
      const kind = flag === "links" ? "decision" : flag === "touches" ? "increment" : "arc";
      const created = (await library.list(kind)).find(({ id }) => accepted.stdout.includes(id));
      assert.ok(created, accepted.stdout);
      assert.deepEqual((created.fields as Record<string, unknown>)[flag], ids);
    });
  });
}
