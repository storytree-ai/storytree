import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("map 4.1: affected exposes the branch's promises through counts, dry-run, show and the same map diff selection", async () => {
  await inWorld(command, async world => {
    const library = await world.library();
    const story = await library.addStory({ title: "The app" });
    const cap = await library.addCapability({ story: story.id, title: "2 · Projects" });
    const promise = await library.addContract({ capability: cap.id, title: "2.5 · Empty projects show a next step" });
    const source = path.join(world.folder, "packages/app/src");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "view.ts"), "export const view = 1;\n");
    writeFileSync(path.join(source, "view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);\n');
    const git = (...args: string[]) => execFileSync("git", args, { cwd: world.folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-b", "main");
    git("add", ".");
    git("-c", "user.name=Map test", "-c", "user.email=map@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Baseline");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(path.join(source, "view.ts"), "export const view = 2;\n");

    const counted = await world.run(["affected", "--json"]);
    assert.equal(counted.code, 0, counted.stderr);
    const counts = JSON.parse(counted.stdout);
    assert.equal(counts.mode, "counts");
    assert.equal(counts.rows, undefined);
    assert.ok(counts.rowCount >= 4);
    assert.deepEqual(counts.selected, ["diff:origin/main"]);
    const dry = await world.run(["affected", "--dry-run", "--json"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).rows, undefined);
    assert.equal(JSON.parse(dry.stdout).estimatedTokens, counts.estimatedTokens);
    const shown = await world.run(["affected", "origin/main", "--show", "--json"]);
    assert.equal(shown.code, 0, shown.stderr);
    const answer = JSON.parse(shown.stdout);
    for (const id of [cap.id, promise.id, "test:packages/app/src/view.test.ts"]) assert.ok(answer.rows.some((row: { id: string }) => row.id === id), id);
    const focused = await world.run(["map", "--select", "diff:origin/main", "--show", "--json"]);
    assert.equal(focused.code, 0, focused.stderr);
    assert.deepEqual(JSON.parse(focused.stdout), answer);
    const narrow = await world.run(["affected", "--range", "origin/main", "--down", "0", "--kind", "file,test", "--show", "--json"]);
    assert.equal(narrow.code, 0, narrow.stderr);
    assert.deepEqual(JSON.parse(narrow.stdout).rows.map((row: { path: string }) => row.path), ["packages/app/src/view.ts"]);
    const text = await world.run(["affected"]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /rows; approximately/);
    const bad = await world.run(["affected", "--range", "no-such-ref"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /no-such-ref/);
    const conflicting = await world.run(["affected", "HEAD", "--range", "origin/main"]);
    assert.equal(conflicting.code, 2);
  });
});
