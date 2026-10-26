/** Capability 4 · Updates, contract 4.4: an agent at work in the app's library holds a downloaded release back. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { openActivityLog } from "@storytree/session-management";
import { connect } from "@storytree/library";

import { agentActiveAt } from "./agent-activity.js";

test("4.4 a session's line in the last hour, not its end, counts as an agent at work as late as that line", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  const storytree = await connect({ url });
  const log = await openActivityLog(url);
  try {
    const before = Date.now() - 60_000;
    await log.append(`t-${randomBytes(4).toString("hex")}`, { session: `active-${randomBytes(4).toString("hex")}`, source: "hook", kind: "session-started" });
    const at = await agentActiveAt(storytree);
    assert.ok(at !== undefined && at >= before, `an agent is at work (got ${at})`);
  } finally {
    await log.close();
    await storytree.close();
  }
});
