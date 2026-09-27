/**
 * Capability 1 · Work states (the arc surface story), at part grain: one state for each part, from
 * the agent activity log's claimed and landed lines, and one for each story, from its parts. The
 * log's lines are written out here as the log hands them out, so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link";

import { workStates } from "./work-states.js";

/** A project's agent activity log, as linesSince hands it out. */
class Log {
  readonly lines: Line[] = [];

  claim(session: string, capability: string): this {
    return this.#add({ kind: "claimed", session, source: "tool", capability, reason: "building it" });
  }

  land(session: string, capability: string): this {
    return this.#add({ kind: "landed", session, source: "tool", capability });
  }

  release(session: string, capability: string): this {
    return this.#add({ kind: "released", session, source: "tool", capability });
  }

  end(session: string): this {
    return this.#add({ kind: "session-ended", session, source: "hook" });
  }

  edit(session: string): this {
    return this.#add({ kind: "file-edited", session, source: "hook", files: ["src/a.ts"] });
  }

  #add(line: NewLine): this {
    const seq = this.lines.length + 1;
    this.lines.push({ ...line, seq, project: "shop", at: new Date(Date.UTC(2026, 8, 27, 12, 0, seq)).toISOString() });
    return this;
  }
}

test("1.1 a part no line names is planned; a claim makes it in progress, a landed report landed, and a new claim after landing in progress again", () => {
  const log = new Log().edit("s1");
  assert.equal(workStates(log.lines).part("cap_a"), "planned");

  log.claim("s1", "cap_a");
  assert.equal(workStates(log.lines).part("cap_a"), "in-progress");
  assert.equal(workStates(log.lines).part("cap_b"), "planned", "a claim on one part leaves the others planned");

  log.land("s1", "cap_a");
  assert.equal(workStates(log.lines).part("cap_a"), "landed");

  log.claim("s2", "cap_a");
  assert.equal(workStates(log.lines).part("cap_a"), "in-progress");
});

test("1.2 a part released, or whose window closes, without landing stays in progress", () => {
  const released = new Log().claim("s1", "cap_a").release("s1", "cap_a");
  assert.equal(workStates(released.lines).part("cap_a"), "in-progress");

  const closed = new Log().claim("s1", "cap_a").end("s1");
  assert.equal(workStates(closed.lines).part("cap_a"), "in-progress");
});

test("1.3 a story is planned while every part is planned or it has none, landed once every part has landed, and in progress otherwise", () => {
  const log = new Log();
  const parts = ["cap_a", "cap_b"];
  assert.equal(workStates(log.lines).story(parts), "planned");
  assert.equal(workStates(log.lines).story([]), "planned");

  log.claim("s1", "cap_a");
  assert.equal(workStates(log.lines).story(parts), "in-progress");

  log.land("s1", "cap_a");
  assert.equal(workStates(log.lines).story(parts), "in-progress", "one part landed and one planned is in progress");

  log.claim("s1", "cap_b").land("s1", "cap_b");
  assert.equal(workStates(log.lines).story(parts), "landed");
});
