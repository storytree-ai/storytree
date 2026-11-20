// Capability 4 · Look inside and inspect an artifact
import assert from "node:assert/strict";
import { test } from "node:test";

import { LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";
import type { SessionWindow } from "@storytree/session-management";

import { createKnowledgeCore } from "./surface.js";

test("4.16 selecting a session asks the host for its window; one answered after the selection moved on is dropped, and deselecting shows none", async () => {
  const asked: string[] = [];
  const answers = new Map<string, (window: SessionWindow) => void>();
  const core = createKnowledgeCore("app", { reads: { windowReading: (project, session) => {
    asked.push(`${project} ${session}`);
    return new Promise((resolve) => answers.set(session, resolve));
  } } });
  const windowOf = (): SessionWindow | undefined => (core as unknown as { get(): { window: SessionWindow | undefined } }).get().window;
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  try {
    core.select("S");
    core.select("T");
    answers.get("S")?.(reading("S"));
    answers.get("T")?.(reading("T"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(asked, ["app S", "app T"]);
    assert.equal(windowOf()?.session, "T");

    core.select(undefined);
    assert.equal(windowOf(), undefined);
  } finally {
    core.dispose();
  }
});

test("4.18 with none selected, showing the listed sessions asks the host for no window; selecting one asks for its window alone", async () => {
  const asked: string[] = [];
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  const core = createKnowledgeCore("app", { reads: { windowReading: async (_project, session) => { asked.push(session); return reading(session); } } });
  const a = { session: "a", label: "A", colour: "hsl(1, 80%, 68%)", members: ["a", "a-child"] };
  const b = { session: "b", label: "B", colour: "hsl(2, 80%, 68%)", members: ["b"] };
  try {
    core.showRoster([a, b]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(asked, [], "no window is read with none selected");
    core.select("b");
    core.showRoster([a, b]);
    assert.deepEqual(asked, ["b"], "the selected session's alone");
  } finally {
    core.dispose();
  }
});

test("4.16, 4.23 a failed read of the selected session's window, or of the factory's notes, keeps what was shown and writes the failure to the console, so app.log", async (t) => {
  let bothLogged!: () => void;
  const logs = new Promise<void>((resolve) => { bothLogged = resolve; });
  const logged = t.mock.method(console, "error", () => { if (logged.mock.callCount() === 1) bothLogged(); });
  const core = createKnowledgeCore("app", { reads: {
    windowReading: async () => { throw new Error("the window was not read"); },
    inherited: async () => { throw new Error("the factory did not answer"); },
  } });
  try {
    const close = (core as unknown as { view(): () => void }).view();
    core.select("S");
    await logs;
    close();
    assert.equal((core as unknown as { get(): { window: SessionWindow | undefined } }).get().window, undefined);
    assert.deepEqual(logged.mock.calls.map((call) => [call.arguments[0], (call.arguments[1] as Error).message]), [
      ["knowledge-core: the factory's notes could not be read", "the factory did not answer"],
      ["knowledge-core: the selected session's window could not be read", "the window was not read"],
    ]);
  } finally {
    core.dispose();
  }
});

test("4.26 · a selected session's window re-read every ten seconds through a library outage says it once to the console, one line with no stack, then once that the library answers again when a read succeeds; any other failed read is logged in full each time", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const logged = t.mock.method(console, "error", () => {});
  const outage = new Error(`${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH 100.64.0.1:5432`);
  const broken = new Error("the window's reads table is missing");
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  const answers: Array<SessionWindow | Error> = [outage, outage, outage, reading("S"), reading("S"), broken, broken];
  let reads = 0;
  const core = createKnowledgeCore("app", { reads: { windowReading: async () => {
    const answer = answers[reads++] ?? reading("S");
    if (answer instanceof Error) throw answer;
    return answer;
  } } });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const nextRead = async () => { t.mock.timers.tick(10_000); await settle(); };
  const said = () => logged.mock.calls.map((call) => call.arguments);
  try {
    core.select("S");
    await settle();
    await nextRead();
    await nextRead();
    assert.equal(reads, 3);
    assert.equal(said().length, 1, "three reads failing through the outage say it once");
    const [line] = said();
    assert.equal(line?.length, 1, "a line, with no error beside it");
    assert.equal(typeof line?.[0], "string");
    assert.doesNotMatch(line?.[0] as string, /\n/, "one line");
    assert.match(line?.[0] as string, /The library cannot be reached: connect EHOSTUNREACH 100\.64\.0\.1:5432/);

    await nextRead();
    assert.equal(said().length, 2);
    assert.equal(said()[1]?.length, 1);
    assert.match(said()[1]?.[0] as string, /the library answers again$/);
    await nextRead();
    assert.equal(said().length, 2, "a later read that succeeds says nothing more");

    await nextRead();
    await nextRead();
    assert.equal(reads, 7);
    const others = said().slice(2);
    assert.equal(others.length, 2, "any other failure is logged each read");
    for (const other of others) assert.equal(other.at(-1), broken, "with the error itself, in full");
  } finally {
    core.dispose();
  }
});
