/**
 * Capability 1 · Project routing: Session management's light routing entry (contract 1.15). The command
 * line asks "is this a project, and is storytree running?" through `@storytree/session-management/routing`
 * rather than the link's root, so that answer does not wait on everything else the link carries.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, route } from "@storytree/session-management/routing";

import { withTempDir } from "../testing/folders.js";

test("1.15 the routing entry alone routes a folder: one that is no project, and a project whose app is stopped", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const stopped = { home, dataDir: path.join(home, "pgdata") };

    const plain = path.join(dir, "plain");
    mkdirSync(plain);
    assert.deepEqual(route(plain, stopped), { status: "not-a-project", message: NOT_A_PROJECT });

    const site = path.join(dir, "site");
    mkdirSync(path.join(site, "src"), { recursive: true });
    writeFileSync(path.join(site, MARKER_FILE), `${JSON.stringify({ project: "site" })}\n`);
    assert.deepEqual(route(path.join(site, "src"), stopped), { status: "not-running", project: "site", message: NOT_RUNNING });
  });
});
